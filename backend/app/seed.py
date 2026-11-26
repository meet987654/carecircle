"""Demo family so the app is useful the moment `docker compose up` finishes.

Daily medicines are schedules, so the demo stays meaningful on any day it is opened.
"""

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    CareRecipient,
    CareTask,
    FamilyMember,
    TaskCategory,
    TaskSchedule,
    TaskStatus,
)
from app.services.tasks import ensure_daily_instances

DAILY = [
    ("Metformin 500 mg (after breakfast)", TaskCategory.medicine, time(9, 0)),
    ("BP tablet - Amlodipine 5 mg", TaskCategory.medicine, time(8, 0)),
    ("Check-in call with Mum", TaskCategory.call, time(13, 0)),
    ("Evening walk (15 min)", TaskCategory.other, time(18, 0)),
    ("BP tablet - Amlodipine 5 mg", TaskCategory.medicine, time(20, 0)),
]


def seed(db: Session, now: datetime | None = None) -> bool:
    if db.scalar(select(CareRecipient.id).limit(1)) is not None:
        return False

    mum = CareRecipient(name="Kamala Sharma", display_name="Mum", timezone="Asia/Kolkata")
    db.add(mum)
    db.flush()
    ravi = FamilyMember(recipient_id=mum.id, name="Ravi", relation="Son")
    priya = FamilyMember(recipient_id=mum.id, name="Priya", relation="Daughter")
    anil = FamilyMember(recipient_id=mum.id, name="Anil", relation="Son-in-law")
    db.add_all([ravi, priya, anil])
    for title, category, at in DAILY:
        db.add(TaskSchedule(recipient_id=mum.id, title=title, category=category, time_of_day=at))
    db.flush()

    tz = ZoneInfo(mum.timezone)
    now = now or datetime.now(tz)
    today = now.astimezone(tz).date()
    # One-off appointment later today.
    db.add(
        CareTask(
            recipient_id=mum.id,
            title="Dr. Mehta - diabetes follow-up (bring sugar log)",
            category=TaskCategory.appointment,
            due_at=datetime.combine(today, time(16, 30), tzinfo=tz),
            status=TaskStatus.pending,
            created_by_id=priya.id,
        )
    )
    db.commit()

    # Pre-complete the morning dose so "who did what" has something to show.
    ensure_daily_instances(db, mum, today)
    metformin = db.scalar(
        select(CareTask).where(
            CareTask.title.like("Metformin%"),
            CareTask.due_at == datetime.combine(today, time(9, 0), tzinfo=tz),
        )
    )
    if metformin is not None and metformin.due_at < now:
        metformin.status = TaskStatus.done
        metformin.completed_by_id = ravi.id
        metformin.completed_at = metformin.due_at + timedelta(minutes=7)
        db.commit()
    return True
