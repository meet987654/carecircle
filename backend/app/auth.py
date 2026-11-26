"""Login for family members: scrypt password hashes and HMAC-signed session tokens.

Standard library only. A token is "<member_id>.<expires_unix>.<signature>", signed with
AUTH_SECRET, so the server needs no session table and a tampered or expired token is
rejected. It travels in an httpOnly, SameSite=Lax cookie: page scripts can't read it,
and other sites can't make the browser send it on a POST. A Bearer header also works,
for API clients and Swagger.
"""

import base64
import hashlib
import hmac
import secrets
import time

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import FamilyMember

COOKIE_NAME = "carecircle_session"
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        scheme, salt, digest = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    candidate = hashlib.scrypt(password.encode(), salt=_unb64(salt), **_SCRYPT)
    return hmac.compare_digest(candidate, _unb64(digest))


# Verify against this when the email is unknown, so a wrong email takes as long as a
# wrong password and response times don't reveal which emails exist.
DUMMY_HASH = hash_password(secrets.token_hex(8))


def _sign(payload: str) -> str:
    key = get_settings().auth_secret.encode()
    return _b64(hmac.new(key, payload.encode(), hashlib.sha256).digest())


def issue_token(member_id: int, now: float | None = None) -> str:
    expires = int((now or time.time()) + get_settings().session_days * 86400)
    payload = f"{member_id}.{expires}"
    return f"{payload}.{_sign(payload)}"


def read_token(token: str, now: float | None = None) -> int | None:
    """Return the member id for a valid, unexpired token, else None."""
    try:
        member_id, expires, signature = token.split(".")
        if not hmac.compare_digest(signature, _sign(f"{member_id}.{expires}")):
            return None
        if int(expires) < (now or time.time()):
            return None
        return int(member_id)
    except (ValueError, AttributeError):
        return None


def _token_from(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return request.cookies.get(COOKIE_NAME)


def current_member(request: Request, db: Session = Depends(get_db)) -> FamilyMember:
    token = _token_from(request)
    member_id = read_token(token) if token else None
    member = db.get(FamilyMember, member_id) if member_id else None
    if member is None:
        raise HTTPException(401, "Please log in", headers={"WWW-Authenticate": "Bearer"})
    return member
