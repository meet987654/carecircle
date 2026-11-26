"""Speech in and out for the voice agent: a simple cascaded pipeline.

    microphone -> speech-to-text -> the same grounded assistant as text -> text-to-speech

The browser records one utterance (it detects when you stop talking), we transcribe it
with Whisper on any OpenAI-compatible /audio/transcriptions endpoint (Groq by default),
and the answer streams back over the normal SSE path. Speaking the answer happens in
the browser (free, instant) unless a server voice is configured (/audio/speech).
"""

from __future__ import annotations

import time

import httpx

from app.config import Settings

# Whisper accepts these containers; browsers record webm/opus (Chrome, Edge, Firefox)
# or mp4/aac (Safari).
AUDIO_TYPES = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
}
MAX_AUDIO_BYTES = 5 * 1024 * 1024  # roughly 5 minutes of opus; one question is a few seconds


class VoiceUnavailable(Exception):
    """Server speech isn't configured; the browser falls back to its own."""


def stt_enabled(settings: Settings) -> bool:
    return bool(settings.llm_api_key and settings.stt_model)


def tts_enabled(settings: Settings) -> bool:
    return bool(settings.llm_api_key and settings.tts_model)


def vocabulary_hint(words: list[str]) -> str:
    """Whisper's `prompt` biases spelling: medicine and family names are the words it
    would otherwise get wrong ("Amlodipine", "Priya")."""
    seen: dict[str, None] = {}
    for w in words:
        if w and w not in seen:
            seen[w] = None
    return ", ".join(seen)[:800]


async def transcribe(settings: Settings, audio: bytes, content_type: str, hint: str) -> tuple[str, int]:
    """Return (text, milliseconds)."""
    if not stt_enabled(settings):
        raise VoiceUnavailable("speech-to-text is not configured")
    ext = AUDIO_TYPES[content_type]
    started = time.perf_counter()
    async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
        resp = await client.post(
            f"{settings.llm_base_url.rstrip('/')}/audio/transcriptions",
            headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            files={"file": (f"question.{ext}", audio, content_type)},
            data={
                "model": settings.stt_model,
                "language": "en",
                "prompt": hint,
                "temperature": "0",
                "response_format": "json",
            },
        )
        resp.raise_for_status()
    text = (resp.json().get("text") or "").strip()
    return text, int((time.perf_counter() - started) * 1000)


async def synthesize(settings: Settings, text: str) -> bytes:
    """One sentence to WAV audio with the server voice."""
    if not tts_enabled(settings):
        raise VoiceUnavailable("text-to-speech is not configured")
    async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
        resp = await client.post(
            f"{settings.llm_base_url.rstrip('/')}/audio/speech",
            headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            json={
                "model": settings.tts_model,
                "voice": settings.tts_voice,
                "input": text,
                "response_format": "wav",
            },
        )
        resp.raise_for_status()
    return resp.content
