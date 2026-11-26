"""End-to-end API tests against Postgres (skipped if no database is reachable)."""

import json
import threading
from datetime import datetime, timedelta, timezone

from app.config import Settings

NOW = lambda: datetime.now(timezone.utc)  # noqa: E731


def iso(dt: datetime) -> str:
    return dt.isoformat()


def make_task(client, title, due_at, **extra):
    r = client.post("/api/tasks", json={"title": title, "category": "medicine", "due_at": iso(due_at), **extra})
    assert r.status_code == 201, r.text
    return r.json()


def test_today_endpoint_buckets_and_records_who_did_it(client):
    late = make_task(client, "Morning BP", NOW() - timedelta(hours=2))
    now_due = make_task(client, "Insulin", NOW())
    done = make_task(client, "Metformin", NOW() - timedelta(hours=1))

    r = client.post(f"/api/tasks/{done['id']}/complete")
    assert r.status_code == 200
    assert r.json()["completed_by"]["name"] == "Ravi"
    assert r.json()["completed_at"] is not None

    today = client.get("/api/today").json()
    assert [t["id"] for t in today["overdue"]] == [late["id"]]
    assert [t["id"] for t in today["due"]] == [now_due["id"]]
    assert [t["id"] for t in today["done"]] == [done["id"]]

    # Undo puts it back where it was.
    client.post(f"/api/tasks/{done['id']}/reopen")
    assert done["id"] in [t["id"] for t in client.get("/api/today").json()["overdue"]]


def test_two_people_marking_done_at_once_only_one_wins(client):
    from app.db import SessionLocal
    from app.services import tasks as svc

    members = client.get("/api/recipient").json()["members"]
    task = make_task(client, "Evening BP", NOW())

    barrier = threading.Barrier(len(members) * 4)
    outcomes: list[str] = []

    def tap(member_id):
        with SessionLocal() as db:
            barrier.wait()  # release all taps together
            try:
                svc.complete_task(db, task["id"], member_id, NOW())
                outcomes.append("won")
            except svc.TaskAlreadyDone:
                outcomes.append("already_done")

    threads = [threading.Thread(target=tap, args=(m["id"],)) for m in members * 4]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert outcomes.count("won") == 1
    assert outcomes.count("already_done") == len(threads) - 1

    # And over HTTP the loser is told who beat them, with a 409.
    r = client.post(f"/api/tasks/{task['id']}/complete")
    assert r.status_code == 409
    assert "already marked this done" in r.json()["detail"]
    assert r.json()["task"]["status"] == "done"


def test_daily_task_appears_once_per_day(client):
    make_task(client, "Amlodipine", NOW() - timedelta(minutes=1), repeats_daily=True)
    client.get("/api/today")
    client.get("/api/today")  # materialising again must not duplicate
    today = client.get("/api/today").json()
    rows = [t for group in ("overdue", "due", "done") for t in today[group] if t["title"] == "Amlodipine"]
    assert len(rows) == 1 and rows[0]["repeats_daily"] is True


def read_sse(response) -> list[tuple[str, dict]]:
    events = []
    for block in response.text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    return events


def test_ask_streams_tokens_and_logs_the_interaction(client):
    ravi = client.get("/api/recipient").json()["members"][0]
    make_task(client, "BP tablet", NOW() - timedelta(hours=2))

    with client.stream("POST", "/api/assistant/ask", json={"question": "Any medicine pending?"}) as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        r.read()
        events = read_sse(r)

    kinds = [e for e, _ in events]
    assert kinds[0] == "meta" and kinds[-1] == "done" and kinds.count("token") > 3
    answer = "".join(d["text"] for e, d in events if e == "token")
    assert "BP tablet" in answer and "late" in answer

    log = client.get("/api/assistant/interactions").json()[0]
    assert log["id"] == events[0][1]["interaction_id"]
    assert log["question"] == "Any medicine pending?"
    assert log["member_id"] == ravi["id"]
    assert log["answer"] == answer
    assert log["context"]["overdue"][0]["title"] == "BP tablet"
    assert log["status"] == "ok" and log["latency_ms"] >= log["first_token_ms"] >= 0

    assert client.post(f"/api/assistant/interactions/{log['id']}/feedback", json={"helpful": True}).status_code == 204
    assert client.get("/api/assistant/interactions").json()[0]["feedback"] == 1


def test_ask_falls_back_to_template_when_llm_is_down(client, monkeypatch):
    from app.routers import assistant as router

    broken = Settings(assistant_provider="openai_compatible", llm_base_url="http://127.0.0.1:9", llm_timeout_seconds=1)
    monkeypatch.setattr(router, "get_settings", lambda: broken)

    with client.stream("POST", "/api/assistant/ask", json={"question": "What's left?"}) as r:
        r.read()
        events = read_sse(r)

    assert events[-1][0] == "done"
    log = client.get("/api/assistant/interactions").json()[0]
    assert log["status"] == "fallback" and log["error"]
    assert log["answer"].startswith("There is nothing")


def test_follow_up_question_uses_the_conversation_and_is_logged(client):
    make_task(client, "BP tablet", NOW() - timedelta(hours=2))
    make_task(client, "Physio call", NOW() + timedelta(hours=1), category="call")
    history = [{"question": "Any medicine for Mum today?", "answer": "The BP tablet is 2 h late."}]

    with client.stream("POST", "/api/assistant/ask", json={"question": "Did she take it?", "history": history}) as r:
        r.read()
        answer = "".join(d["text"] for e, d in read_sse(r) if e == "token")

    assert "BP tablet" in answer and "Physio" not in answer
    log = client.get("/api/assistant/interactions").json()[0]
    assert log["context"]["conversation"] == history


def test_voice_transcribe_and_spoken_question_is_logged(client, monkeypatch):
    from app.routers import voice as router
    from app.services import voice

    make_task(client, "Amlodipine 5 mg", NOW() - timedelta(hours=1))
    seen = {}

    async def fake_transcribe(settings, audio, content_type, hint):
        seen.update(audio=audio, content_type=content_type, hint=hint)
        return "Did she take the Amlodipine?", 210

    monkeypatch.setattr(voice, "transcribe", fake_transcribe)
    monkeypatch.setattr(router, "get_settings", lambda: Settings(llm_api_key="k"))

    assert client.get("/api/voice/config").json()["stt"] == "server"
    r = client.post("/api/voice/transcribe", content=b"\x1aE\xdf\xa3fake-webm",
                    headers={"Content-Type": "audio/webm;codecs=opus"})
    assert r.json() == {"text": "Did she take the Amlodipine?", "ms": 210}
    assert seen["content_type"] == "audio/webm"
    assert "Amlodipine 5 mg" in seen["hint"] and "Ravi" in seen["hint"]  # spelling hints

    assert client.post("/api/voice/transcribe", content=b"x", headers={"Content-Type": "text/plain"}).status_code == 415
    assert client.post("/api/voice/transcribe", content=b"", headers={"Content-Type": "audio/webm"}).status_code == 422

    with client.stream("POST", "/api/assistant/ask",
                       json={"question": r.json()["text"], "channel": "voice", "stt_ms": 210}) as s:
        s.read()
    log = client.get("/api/assistant/interactions").json()[0]
    assert log["channel"] == "voice" and log["stt_ms"] == 210 and "Amlodipine" in log["answer"]


def test_voice_without_a_key_tells_the_browser_to_use_its_own(client, monkeypatch):
    from app.routers import voice as router

    monkeypatch.setattr(router, "get_settings", lambda: Settings(llm_api_key=""))
    assert client.get("/api/voice/config").json() == {"stt": "browser", "tts": "browser"}
    r = client.post("/api/voice/transcribe", content=b"abc", headers={"Content-Type": "audio/webm"})
    assert r.status_code == 503


def test_deepgram_voice_request_and_speak_endpoint(client, monkeypatch):
    import asyncio

    import httpx

    from app.routers import voice as router
    from app.services import voice

    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent.update(url=str(request.url), auth=request.headers["authorization"], body=json.loads(request.content))
        return httpx.Response(200, content=b"ID3mp3", headers={"content-type": "audio/mpeg"})

    settings = Settings(tts_provider="deepgram", deepgram_api_key="dg-key")
    audio, media_type = asyncio.run(voice.synthesize(settings, "Ravi gave the tablet.", httpx.MockTransport(handler)))
    assert (audio, media_type) == (b"ID3mp3", "audio/mpeg")
    assert sent["url"].startswith("https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3")
    assert sent["auth"] == "Token dg-key" and sent["body"] == {"text": "Ravi gave the tablet."}

    # Through the API: config says the server speaks, and /speak returns the audio.
    async def fake_synthesize(s, text):
        return b"ID3mp3", "audio/mpeg"

    monkeypatch.setattr(router, "get_settings", lambda: settings)
    monkeypatch.setattr(voice, "synthesize", fake_synthesize)
    assert client.get("/api/voice/config").json()["tts"] == "server"
    r = client.post("/api/voice/speak", json={"text": "Hello"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == b"ID3mp3"
