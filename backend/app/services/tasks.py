from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import CareRecipient, CareTask, TaskSchedule, TaskStatus
from app.services.today import TodayGroups, day_bounds, group_today, local_day_bounds


class TaskAlreadyDone(Exception):
    def __init__(self, task: CareTask):
        self.task = task


def ensure_daily_instances(db: Session, recipient: CareRecipient, local_date: date) -> None:
    """Create today's CareTask rows for every active daily schedule (idempotent).

    Uses INSERT .. ON CONFLICT DO NOTHING on (schedule_id, due_at), so two
    requests racing to materialise the same day cannot create duplicates.
    """
    tz = ZoneInfo(recipient.timezone)
    schedules = db.scalars(
        select(TaskSchedule).where(
            TaskSchedule.recipient_id == recipient.id, TaskSchedule.active.is_(True)
        )
    ).all()
    if not schedules:
        return
    rows = [
        {
            "recipient_id": recipient.id,
            "schedule_id": s.id,
            "title": s.title,
            "category": s.category,
            "notes": s.notes,
            "due_at": datetime.combine(local_date, s.time_of_day, tzinfo=tz),
            "status": TaskStatus.pending,
        }
        for s in schedules
    ]
    db.execute(insert(CareTask).values(rows).on_conflict_do_nothing(constraint="uq_task_schedule_due"))
    db.commit()


def get_today(db: Session, recipient: CareRecipient, now: datetime) -> TodayGroups:
    tz = ZoneInfo(recipient.timezone)
    ensure_daily_instances(db, recipient, now.astimezone(tz).date())
    start, end = local_day_bounds(now, tz)

    # Fetch only rows that could belong to today; the exact bucketing lives in group_today.
    candidates = db.scalars(
        select(CareTask)
        .options(selectinload(CareTask.completed_by))
        .where(
            CareTask.recipient_id == recipient.id,
            or_(
                and_(CareTask.status == TaskStatus.pending, CareTask.due_at < end),
                and_(
                    CareTask.status == TaskStatus.done,
                    or_(
                        and_(CareTask.due_at >= start, CareTask.due_at < end),
                        and_(CareTask.completed_at >= start, CareTask.completed_at < end),
                    ),
                ),
            ),
        )
    ).all()
    grace = timedelta(minutes=get_settings().overdue_grace_minutes)
    return group_today(candidates, now, tz, grace)


def complete_task(db: Session, task_id: int, member_id: int, now: datetime) -> CareTask:
    """Mark a task done, exactly once.

    The conditional UPDATE (`WHERE status = 'pending'`) is atomic in Postgres, so
    if two people tap "done" at the same moment only one write wins; the other
    gets TaskAlreadyDone with who actually did it, instead of silently
    overwriting their name.
    """
    result = db.execute(
        update(CareTask)
        .where(CareTask.id == task_id, CareTask.status == TaskStatus.pending)
        .values(status=TaskStatus.done, completed_by_id=member_id, completed_at=now)
        .returning(CareTask.id)
    )
    won = result.scalar_one_or_none() is not None
    db.commit()

    task = db.scalar(
        select(CareTask)
        .options(selectinload(CareTask.completed_by))
        .where(CareTask.id == task_id)
        .execution_options(populate_existing=True)
    )
    if task is None:
        raise LookupError(task_id)
    if not won:
        raise TaskAlreadyDone(task)
    return task


def reopen_task(db: Session, task: CareTask) -> CareTask:
    task.status = TaskStatus.pending
    task.completed_at = None
    task.completed_by_id = None
    db.commit()
    db.refresh(task)
    return task


def list_tasks(
    db: Session,
    recipient: CareRecipient,
    on_date: date | None = None,
    status: TaskStatus | None = None,
) -> list[CareTask]:
    query = select(CareTask).options(selectinload(CareTask.completed_by)).where(
        CareTask.recipient_id == recipient.id
    )
    if on_date is not None:
        start, end = day_bounds(on_date, ZoneInfo(recipient.timezone))
        query = query.where(CareTask.due_at >= start, CareTask.due_at < end)
    if status is not None:
        query = query.where(CareTask.status == status)
    return list(db.scalars(query.order_by(CareTask.due_at)).all())
