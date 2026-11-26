from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import current_member
from app.db import get_db
from app.models import CareRecipient, FamilyMember


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def current_recipient(
    member: FamilyMember = Depends(current_member), db: Session = Depends(get_db)
) -> CareRecipient:
    """The family is whoever the logged-in member belongs to, so every query is scoped to it."""
    recipient = db.scalar(
        select(CareRecipient)
        .options(selectinload(CareRecipient.members))
        .where(CareRecipient.id == member.recipient_id)
    )
    if recipient is None:
        raise HTTPException(404, "Care recipient not found")
    return recipient
