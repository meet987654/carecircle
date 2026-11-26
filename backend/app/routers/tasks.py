from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_recipient, require_member, utcnow
from app.models import CareRecipient, CareTask, TaskSchedule, TaskStatus
from app.schemas import CompleteRequest, RecipientOut, TaskCreate, TaskOut, TaskUpdate, TodayOut
from app.services import tasks as svc

router = APIRouter(prefix="/api")


def _localize(dt: datetime, recipient: CareRecipient) -> datetime:
    """Naive datetimes from the client are wall-clock time where the care recipient lives."""
    return dt.replace(tzinfo=ZoneInfo(recipient.timezone)) if dt.tzinfo is None else dt


def _get_task(db: Session, recipient: CareRecipient, task_id: int) -> CareTask:
    task = db.get(CareTask, task_id)
    if task is None or task.recipient_id != recipient.id:
        raise HTTPException(404, "Task not found")
    return task


@router.get("/recipient", response_model=RecipientOut)
def get_recipient(recipient: CareRecipient = Depends(current_recipient)):
    return recipient


@router.get("/today", response_model=TodayOut)
def today(db: Session = Depends(get_db), recipient: CareRecipient = Depends(current_recipient)):
    now = utcnow()
    groups = svc.get_today(db, recipient, now)
    return TodayOut(
        date=now.astimezone(ZoneInfo(recipient.timezone)).date().isoformat(),
        timezone=recipient.timezone,
        now=now,
        overdue=[TaskOut.from_task(t) for t in groups.overdue],
        due=[TaskOut.from_task(t) for t in groups.due],
        done=[TaskOut.from_task(t) for t in groups.done],
    )


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(
    on: date | None = None,
    status: TaskStatus | None = None,
    db: Session = Depends(get_db),
    recipient: CareRecipient = Depends(current_recipient),
):
    return [TaskOut.from_task(t) for t in svc.list_tasks(db, recipient, on, status)]


@router.post("/tasks", response_model=TaskOut, status_code=201)
def create_task(
    body: TaskCreate,
    db: Session = Depends(get_db),
    recipient: CareRecipient = Depends(current_recipient),
):
    if body.created_by_id is not None:
        require_member(db, recipient, body.created_by_id)
    due_at = _localize(body.due_at, recipient)

    schedule_id = None
    if body.repeats_daily:
        schedule = TaskSchedule(
            recipient_id=recipient.id,
            title=body.title,
            category=body.category,
            notes=body.notes,
            time_of_day=due_at.astimezone(ZoneInfo(recipient.timezone)).time(),
        )
        db.add(schedule)
        db.flush()
        schedule_id = schedule.id

    task = CareTask(
        recipient_id=recipient.id,
        schedule_id=schedule_id,
        title=body.title,
        category=body.category,
        notes=body.notes,
        due_at=due_at,
        status=TaskStatus.pending,
        created_by_id=body.created_by_id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return TaskOut.from_task(task)


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(
    task_id: int,
    body: TaskUpdate,
    db: Session = Depends(get_db),
    recipient: CareRecipient = Depends(current_recipient),
):
    task = _get_task(db, recipient, task_id)
    changes = body.model_dump(exclude_unset=True)
    if "due_at" in changes and changes["due_at"] is not None:
        changes["due_at"] = _localize(changes["due_at"], recipient)
    for field, value in changes.items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return TaskOut.from_task(task)


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    recipient: CareRecipient = Depends(current_recipient),
):
    """Deleting a repeating task also stops the daily repeat (otherwise it would reappear)."""
    task = _get_task(db, recipient, task_id)
    if task.schedule_id is not None:
        schedule = db.get(TaskSchedule, task.schedule_id)
        if schedule is not None:
            schedule.active = False
    db.delete(task)
    db.commit()
    return Response(status_code=204)


@router.post(
    "/tasks/{task_id}/complete",
    response_model=TaskOut,
    responses={409: {"description": "Someone else already marked it done"}},
)
def complete_task(
    task_id: int,
    body: CompleteRequest,
    db: Session = Depends(get_db),
    recipient: CareRecipient = Depends(current_recipient),
):
    _get_task(db, recipient, task_id)
    require_member(db, recipient, body.member_id)
    try:
        task = svc.complete_task(db, task_id, body.member_id, utcnow())
    except svc.TaskAlreadyDone as exc:
        done = exc.task
        who = done.completed_by.name if done.completed_by else "Someone"
        return JSONResponse(
            status_code=409,
            content={
                "detail": f"{who} already marked this done",
                "task": TaskOut.from_task(done).model_dump(mode="json"),
            },
        )
    return TaskOut.from_task(task)


@router.post("/tasks/{task_id}/reopen", response_model=TaskOut)
def reopen_task(
    task_id: int,
    db: Session = Depends(get_db),
    recipient: CareRecipient = Depends(current_recipient),
):
    """Undo a mistaken "done" tap."""
    task = svc.reopen_task(db, _get_task(db, recipient, task_id))
    return TaskOut.from_task(task)
