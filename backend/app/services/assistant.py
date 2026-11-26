"""The "Ask about today" assistant.

Two providers share one interface (an async stream of text chunks):

- TemplateProvider: builds the answer deterministically from the day's tasks.
  No network, no hallucinations, and it is the fallback when an LLM fails.
- OpenAICompatibleProvider: streams from any /v1/chat/completions endpoint
  (Groq, Ollama, OpenAI, ...), grounded on the same context.

Both answer only from `build_context`, which is also what we log.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from app.config import Settings
from app.models import CareRecipient, CareTask, TaskCategory
from app.services.today import TodayGroups

# ---------------------------------------------------------------- context


def fmt_time(dt: datetime, tz: ZoneInfo) -> str:
    """8:00 -> '8 am', 20:30 -> '8:30 pm'."""
    local = dt.astimezone(tz)
    hour = local.strftime("%I").lstrip("0") or "12"
    suffix = "am" if local.hour < 12 else "pm"
    return f"{hour} {suffix}" if local.minute == 0 else f"{hour}:{local.minute:02d} {suffix}"


def fmt_delay(minutes: int) -> str:
    if minutes < 60:
        return f"{minutes} min"
    hours, mins = divmod(minutes, 60)
    return f"{hours} h" if mins == 0 else f"{hours} h {mins} min"


def build_context(recipient: CareRecipient, groups: TodayGroups, now: datetime) -> dict:
    """The structured facts the assistant may use. Stored verbatim in ai_interactions."""
    tz = ZoneInfo(recipient.timezone)

    def item(task: CareTask) -> dict:
        data = {
            "title": task.title,
            "category": task.category.value,
            "due": fmt_time(task.due_at, tz),
            "due_date": task.due_at.astimezone(tz).date().isoformat(),
        }
        if task.completed_at:
            data["done_at"] = fmt_time(task.completed_at, tz)
            data["done_by"] = task.completed_by.name if task.completed_by else "someone"
        return data

    overdue = []
    for t in groups.overdue:
        entry = item(t)
        entry["minutes_late"] = int((now - t.due_at).total_seconds() // 60)
        overdue.append(entry)

    return {
        "care_recipient": recipient.display_name,
        "now": fmt_time(now, tz),
        "today": now.astimezone(tz).date().isoformat(),
        "overdue": overdue,
        "due": [item(t) for t in groups.due],
        "done": [item(t) for t in groups.done],
    }


# ---------------------------------------------------------------- template answer

TOPIC_WORDS: dict[str, tuple[str, ...]] = {
    TaskCategory.medicine.value: (
        "medicine", "medication", "meds", "tablet", "pill", "dose", "insulin", "bp",
        "syrup", "drops", "injection",
    ),
    TaskCategory.appointment.value: (
        "appointment", "doctor", "dr", "clinic", "hospital", "physio", "checkup", "visit",
    ),
    TaskCategory.call.value: ("call", "phone", "check-in", "checkin", "ring"),
}
TOPIC_LABEL = {"medicine": "medicines", "appointment": "appointments", "call": "calls"}
REMAINING_WORDS = ("left", "pending", "remaining", "still", "missed", "overdue", "next", "due")
DONE_WORDS = ("who", "done", "did", "given", "gave", "completed", "finished", "taken")


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z][a-z\-]*", text.lower()))


def detect_topic(question: str) -> str | None:
    words = _words(question)
    for topic, keywords in TOPIC_WORDS.items():
        if words & set(keywords):
            return topic
    return None


def _join(parts: list[str]) -> str:
    if len(parts) <= 1:
        return "".join(parts)
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def compose_answer(question: str, context: dict) -> str:
    """A short, factual answer built only from `context`. Deterministic."""
    name = context["care_recipient"]
    topic = detect_topic(question)
    words = _words(question)
    wants_remaining = bool(words & set(REMAINING_WORDS))
    wants_done = bool(words & set(DONE_WORDS))

    def pick(items: list[dict]) -> list[dict]:
        return [i for i in items if topic is None or i["category"] == topic]

    overdue, due, done = pick(context["overdue"]), pick(context["due"]), pick(context["done"])

    if not (overdue or due or done):
        if topic:
            return f"There are no {TOPIC_LABEL[topic]} on {name}'s list for today."
        return f"There is nothing on {name}'s list for today."

    pending_s = done_s = next_s = None

    if overdue:
        parts = []
        for i in overdue:
            when = f" from {i['due_date']}" if i["due_date"] != context["today"] else ""
            parts.append(f"the {i['due']}{when} {i['title']}, {fmt_delay(i['minutes_late'])} late")
        pending_s = f"Still pending for {name}: {_join(parts)}."

    if due:
        nxt, rest = due[0], due[1:]
        next_s = f"Next up is the {nxt['due']} {nxt['title']}"
        if rest:
            next_s += ", then " + _join([f"{i['due']} {i['title']}" for i in rest])
        next_s += "."

    only_remaining = wants_remaining and not wants_done
    if done and not only_remaining:
        by_person: dict[str, list[str]] = {}
        for i in reversed(done):  # chronological order reads more naturally
            by_person.setdefault(i["done_by"], []).append(
                f"the {i['due']} {i['title']} (at {i['done_at']})"
            )
        done_s = _join([f"{who} did {_join(items)}" for who, items in by_person.items()]) + "."

    # "Who gave the tablet?" reads better with the done part first.
    if wants_done and not wants_remaining:
        sentences = [done_s, pending_s, next_s]
    else:
        sentences = [pending_s, next_s, done_s]

    if not overdue and not due:
        sentences.append("Everything is done for today.")
    elif not overdue and wants_remaining:
        sentences.insert(0, "Nothing is overdue.")

    text = " ".join(s for s in sentences if s)
    return text[0].upper() + text[1:]


# ---------------------------------------------------------------- providers

SYSTEM_PROMPT = (
    "You help a family coordinate the care of an elderly relative. Answer the "
    "question in at most three short, plain sentences using ONLY the facts in the "
    "JSON of today's tasks. Say who did things and at what time. If the facts do "
    "not answer the question, say so. Never give medical advice or invent tasks."
)


class TemplateProvider:
    name = "template"
    model = None

    def __init__(self, chunk_delay: float = 0.025):
        self.chunk_delay = chunk_delay

    def prompt(self, question: str, context: dict) -> str | None:
        return None

    async def stream(self, question: str, context: dict) -> AsyncIterator[str]:
        answer = compose_answer(question, context)
        # Emit word by word so the UI streams the same way it would for an LLM.
        for chunk in re.findall(r"\S+\s*", answer):
            yield chunk
            await asyncio.sleep(self.chunk_delay)


class OpenAICompatibleProvider:
    name = "openai_compatible"

    def __init__(self, settings: Settings):
        self.base_url = settings.llm_base_url.rstrip("/")
        self.api_key = settings.llm_api_key
        self.model = settings.llm_model
        self.timeout = settings.llm_timeout_seconds

    def messages(self, question: str, context: dict) -> list[dict]:
        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"TODAY'S TASKS:\n{json.dumps(context, indent=1)}\n\nQUESTION: {question}",
            },
        ]

    def prompt(self, question: str, context: dict) -> str:
        return "\n\n".join(f"[{m['role']}]\n{m['content']}" for m in self.messages(question, context))

    async def stream(self, question: str, context: dict) -> AsyncIterator[str]:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        body = {
            "model": self.model,
            "messages": self.messages(question, context),
            "stream": True,
            "temperature": 0.2,
            "max_tokens": 200,
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST", f"{self.base_url}/chat/completions", json=body, headers=headers
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    choices = json.loads(data).get("choices") or [{}]
                    delta = choices[0].get("delta", {}).get("content")
                    if delta:
                        yield delta


def get_provider(settings: Settings) -> TemplateProvider | OpenAICompatibleProvider:
    if settings.assistant_provider == "openai_compatible":
        return OpenAICompatibleProvider(settings)
    return TemplateProvider()
