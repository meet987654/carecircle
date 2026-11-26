import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_recipient, utcnow
from app.models import CareRecipient
from app.schemas import SpeakRequest, TranscriptOut, VoiceConfigOut
from app.services import voice
from app.services.tasks import get_today

router = APIRouter(prefix="/api/voice", tags=["voice"])
log = logging.getLogger(__name__)


@router.get("/config", response_model=VoiceConfigOut)
def config(_: CareRecipient = Depends(current_recipient)):
    """Tells the browser which parts of the pipeline the server handles."""
    settings = get_settings()
    return VoiceConfigOut(
        stt="server" if voice.stt_enabled(settings) else "browser",
        tts="server" if voice.tts_enabled(settings) else "browser",
    )


@router.post("/transcribe", response_model=TranscriptOut)
async def transcribe(
    request: Request,
    db: Session = Depends(get_db),
    recipient: CareRecipient = Depends(current_recipient),
):
    """Body is the raw recording (Content-Type audio/webm, audio/mp4, ...), not a form."""
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in voice.AUDIO_TYPES:
        raise HTTPException(415, f"Unsupported audio type {content_type or '(none)'}")
    audio = await request.body()
    if not audio:
        raise HTTPException(422, "Empty recording")
    if len(audio) > voice.MAX_AUDIO_BYTES:
        raise HTTPException(413, "Recording too long")

    # Today's task titles and the family's names, so Whisper spells them right.
    groups = get_today(db, recipient, utcnow())
    titles = [t.title for t in groups.overdue + groups.due + groups.done]
    hint = voice.vocabulary_hint(
        [recipient.display_name, *(m.name for m in recipient.members), *titles]
    )
    try:
        text, ms = await voice.transcribe(get_settings(), audio, content_type, hint)
    except voice.VoiceUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except httpx.HTTPError as exc:
        log.warning("transcription failed: %r", exc)
        raise HTTPException(502, "Couldn't transcribe that. Please try again.") from exc
    return TranscriptOut(text=text, ms=ms)


@router.post("/speak", responses={200: {"content": {"audio/wav": {}}}})
async def speak(body: SpeakRequest, _: CareRecipient = Depends(current_recipient)):
    """One sentence of the answer as audio (only when a server voice is configured)."""
    try:
        audio = await voice.synthesize(get_settings(), body.text)
    except voice.VoiceUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except httpx.HTTPError as exc:
        log.warning("speech synthesis failed: %r", exc)
        raise HTTPException(502, "Couldn't speak that") from exc
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})
