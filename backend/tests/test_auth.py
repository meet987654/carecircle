"""Login: who is recorded as doing a task comes from the session, not the request."""

from datetime import datetime, timedelta, timezone

from app.auth import hash_password, issue_token, read_token, verify_password
from tests.conftest import login


def test_password_hash_and_token_round_trip():
    stored = hash_password("s3cret")
    assert stored != "s3cret" and verify_password("s3cret", stored)
    assert not verify_password("wrong", stored)
    assert hash_password("s3cret") != stored  # salted

    token = issue_token(7, now=1_000)
    assert read_token(token, now=1_001) == 7
    member_id, expires, signature = token.split(".")
    assert read_token(f"8.{expires}.{signature}", now=1_001) is None  # tampered id
    assert read_token(token, now=int(expires) + 1) is None  # expired


def test_api_requires_login(anon_client):
    for method, path in [("get", "/api/today"), ("get", "/api/recipient"), ("post", "/api/tasks/1/complete"),
                         ("get", "/api/assistant/interactions")]:
        assert getattr(anon_client, method)(path).status_code == 401, path
    assert anon_client.get("/api/health").status_code == 200

    assert login(anon_client, password="nope").status_code == 401
    r = login(anon_client, email="nobody@test")
    assert r.status_code == 401 and r.json()["detail"] == "Email or password is incorrect"


def test_done_is_recorded_as_the_logged_in_member(anon_client):
    r = login(anon_client, email="PRIYA@test")  # email is case-insensitive
    assert r.status_code == 200 and r.json()["member"]["name"] == "Priya"
    assert anon_client.get("/api/auth/me").json()["name"] == "Priya"

    due = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    task = anon_client.post("/api/tasks", json={"title": "Insulin", "due_at": due}).json()
    # A client-sent member id is ignored: the session decides who did it.
    done = anon_client.post(f"/api/tasks/{task['id']}/complete", json={"member_id": 999}).json()
    assert done["completed_by"]["name"] == "Priya"

    # Bearer tokens work too (API clients, Swagger).
    token = r.json()["token"]
    assert anon_client.post("/api/auth/logout").status_code == 204
    anon_client.cookies.clear()
    assert anon_client.get("/api/today").status_code == 401
    assert anon_client.get("/api/today", headers={"Authorization": f"Bearer {token}"}).status_code == 200
