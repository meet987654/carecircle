"""POST /api/assistant/ask streams an answer as Server-Sent Events.

Events:
  meta   {"interaction_id": 12, "provider": "template"}
  token  {"text": "Mum's "}            (many)
  done   {"latency_ms": 840, "first_token_ms": 35}
  error  {"message": "..."}

SSE over a POST response (read with fetch + ReadableStream) rather than
EventSource, so the question goes in a JSON body instead of a URL.
"""

import json
import logging
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal, get_db
from app.auth import current_member
from app.deps import current_recipient, utcnow
from app.models import AIInteraction, CareRecipient, FamilyMember
from app.schemas import AskRequest, FeedbackRequest, InteractionOut
from app.services.assistant import TemplateProvider, build_context, get_provider
from app.services.tasks import get_today

router = APIRouter(prefix="/api/assistant")
log = logging.getLogger(__name__)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _finish(interaction_id: int, **fields) -> None:
    # Own session: the request's session is closed by the time the stream ends.
    with SessionLocal() as db:
        row = db.get(AIInteraction, interaction_id)
        for key, value in fields.items():
            setattr(row, key, value)
        db.commit()


@router.post("/ask")
def ask(
    body: AskRequest,
    db: Session = Depends(get_db),
    recipient: CareRecipient = Depends(current_recipient),
    member: FamilyMember = Depends(current_member),
):
    settings = get_settings()
    provider = get_provider(settings)
    now = utcnow()
    context = build_context(recipient, get_today(db, recipient, now), now)
    question = body.question.strip()
    history = [t.model_dump() for t in body.history]

    interaction = AIInteraction(
        recipient_id=recipient.id,
        member_id=member.id,
        channel=body.channel,
        stt_ms=body.stt_ms,
        question=question,
        # Logged with the conversation so a follow-up's answer can be understood later.
        context={**context, "conversation": history} if history else context,
        prompt=provider.prompt(question, context, history),
        provider=provider.name,
        model=provider.model,
        status="streaming",
    )
    db.add(interaction)
    db.commit()
    interaction_id = interaction.id

    async def stream():
        started = time.perf_counter()
        elapsed = lambda: int((time.perf_counter() - started) * 1000)  # noqa: E731
        answer: list[str] = []
        result = {"status": "ok", "error": None, "first_token_ms": None}

        async def relay(source):
            async for chunk in source.stream(question, context, history):
                if result["first_token_ms"] is None:
                    result["first_token_ms"] = elapsed()
                answer.append(chunk)
                yield sse("token", {"text": chunk})

        yield sse("meta", {"interaction_id": interaction_id, "provider": provider.name})
        try:
            try:
                async for event in relay(provider):
                    yield event
            except Exception as exc:  # LLM down / bad key / timeout
                if answer or isinstance(provider, TemplateProvider):
                    raise
                log.warning("LLM provider failed, falling back to template: %r", exc)
                result.update(status="fallback", error=repr(exc))
                yield sse("meta", {"interaction_id": interaction_id, "provider": "template"})
                async for event in relay(TemplateProvider()):
                    yield event
            yield sse("done", {"latency_ms": elapsed(), "first_token_ms": result["first_token_ms"]})
        except Exception as exc:
            log.exception("assistant stream failed")
            result.update(status="error", error=repr(exc))
            yield sse("error", {"message": "Sorry, I couldn't answer that just now."})
        except BaseException:  # client went away mid-stream (cancellation)
            result["status"] = "client_disconnected"
            raise
        finally:
            # Synchronous on purpose: awaiting inside a cancelled stream would be cancelled too.
            _finish(
                interaction_id,
                answer="".join(answer),
                latency_ms=elapsed(),
                **result,
            )

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/interactions", response_model=list[InteractionOut])
def list_interactions(
    limit: int = 50,
    db: Session = Depends(get_db),
    recipient: CareRecipient = Depends(current_recipient),
):
    """For the team to review what was asked, what the assistant saw and said, and how fast."""
    rows = db.scalars(
        select(AIInteraction)
        .where(AIInteraction.recipient_id == recipient.id)
        .order_by(AIInteraction.id.desc())
        .limit(min(limit, 200))
    ).all()
    return rows


@router.post("/interactions/{interaction_id}/feedback", status_code=204)
def feedback(
    interaction_id: int,
    body: FeedbackRequest,
    db: Session = Depends(get_db),
    recipient: CareRecipient = Depends(current_recipient),
):
    row = db.get(AIInteraction, interaction_id)
    if row is None or row.recipient_id != recipient.id:
        raise HTTPException(404, "Interaction not found")
    row.feedback = 1 if body.helpful else -1
    db.commit()
