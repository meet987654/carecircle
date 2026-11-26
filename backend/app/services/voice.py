"""Speech in and out for the voice agent: a simple cascaded pipeline.

    microphone -> speech-to-text -> the same grounded assistant as text -> text-to-speech

The browser records one utterance (it detects when you stop talking), we transcribe it
with Whisper on any OpenAI-compatible /audio/transcriptions endpoint (Groq by default),
and the answer streams back over the normal SSE path. Speaking the answer happens in
the browser (free, instant) unless a server voice is configured (Deepgram Aura).
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
    return settings.tts_provider == "deepgram" and bool(settings.deepgram_api_key)


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


# One long-lived connection to Deepgram. A new TLS handshake costs 0.7-1.6 s from here,
# which is longer than synthesising a sentence (~0.4 s), so reusing it matters most.
_deepgram: httpx.AsyncClient | None = None


def _deepgram_client(settings: Settings) -> httpx.AsyncClient:
    global _deepgram
    if _deepgram is None or _deepgram.is_closed:
        _deepgram = httpx.AsyncClient(
            base_url=settings.deepgram_base_url.rstrip("/"),
            headers={"Authorization": f"Token {settings.deepgram_api_key}"},
            timeout=settings.llm_timeout_seconds,
            # Retry a connection that dropped while idle instead of failing the sentence.
            transport=httpx.AsyncHTTPTransport(
                retries=1, limits=httpx.Limits(max_keepalive_connections=4, keepalive_expiry=120)
            ),
        )
    return _deepgram


async def close_clients() -> None:
    if _deepgram is not None:
        await _deepgram.aclose()


async def warm_up(settings: Settings) -> None:
    """Open the Deepgram connection when voice mode starts, so the first sentence is fast.
    (A cheap authenticated GET; it uses no credit.)"""
    if not tts_enabled(settings):
        return
    try:
        await _deepgram_client(settings).get("/projects")
    except httpx.HTTPError:
        pass  # the real request will try again


async def synthesize(
    settings: Settings, text: str, transport: httpx.AsyncBaseTransport | None = None
) -> tuple[bytes, str]:
    """One sentence to speech with Deepgram Aura. Returns (audio, media type).

    MP3 keeps each sentence small (~15 KB) so it arrives quickly on a phone connection.
    """
    if not tts_enabled(settings):
        raise VoiceUnavailable("text-to-speech is not configured")
    if transport is not None:  # tests
        async with httpx.AsyncClient(
            base_url=settings.deepgram_base_url.rstrip("/"),
            headers={"Authorization": f"Token {settings.deepgram_api_key}"},
            transport=transport,
        ) as client:
            return await _speak(client, settings, text)
    return await _speak(_deepgram_client(settings), settings, text)


async def _speak(client: httpx.AsyncClient, settings: Settings, text: str) -> tuple[bytes, str]:
    resp = await client.post(
        "/speak", params={"model": settings.tts_voice, "encoding": "mp3"}, json={"text": text}
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("content-type", "audio/mpeg").split(";")[0]
