from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import CareRecipient, FamilyMember


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def current_recipient(db: Session = Depends(get_db)) -> CareRecipient:
    """One family per deployment (see README assumptions): the first care recipient."""
    recipient = db.scalar(
        select(CareRecipient).options(selectinload(CareRecipient.members)).order_by(CareRecipient.id)
    )
    if recipient is None:
        raise HTTPException(503, "No care recipient set up yet")
    return recipient


def require_member(db: Session, recipient: CareRecipient, member_id: int) -> FamilyMember:
    member = db.get(FamilyMember, member_id)
    if member is None or member.recipient_id != recipient.id:
        raise HTTPException(422, f"Unknown family member {member_id}")
    return member
