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
    ravi = client.get("/api/recipient").json()["members"][0]
    late = make_task(client, "Morning BP", NOW() - timedelta(hours=2))
    now_due = make_task(client, "Insulin", NOW())
    done = make_task(client, "Metformin", NOW() - timedelta(hours=1))

    r = client.post(f"/api/tasks/{done['id']}/complete", json={"member_id": ravi["id"]})
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
    r = client.post(f"/api/tasks/{task['id']}/complete", json={"member_id": members[0]["id"]})
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

    with client.stream("POST", "/api/assistant/ask", json={"question": "Any medicine pending?", "member_id": ravi["id"]}) as r:
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
