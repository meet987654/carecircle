from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import COOKIE_NAME, DUMMY_HASH, current_member, issue_token, verify_password
from app.config import get_settings
from app.db import get_db
from app.models import FamilyMember
from app.schemas import LoginOut, LoginRequest, MemberOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginOut)
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    member = db.scalar(select(FamilyMember).where(FamilyMember.email == body.email.strip().lower()))
    # Always run one hash check, and give the same message for a wrong email or password.
    ok = verify_password(body.password, member.password_hash if member else DUMMY_HASH)
    if member is None or not ok:
        raise HTTPException(401, "Email or password is incorrect")

    settings = get_settings()
    token = issue_token(member.id)
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.session_days * 86400,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return LoginOut(member=MemberOut.model_validate(member), token=token)


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    response.status_code = 204
    return response


@router.get("/me", response_model=MemberOut)
def me(member: FamilyMember = Depends(current_member)):
    return member
