from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import TaskCategory, TaskStatus


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class MemberOut(ORM):
    id: int
    name: str
    relation: str | None


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class LoginOut(BaseModel):
    member: MemberOut
    # Also set as an httpOnly cookie; returned for API clients that prefer a Bearer header.
    token: str


class RecipientOut(ORM):
    id: int
    name: str
    display_name: str
    timezone: str
    members: list[MemberOut]


class TaskOut(ORM):
    id: int
    title: str
    category: TaskCategory
    notes: str | None
    due_at: datetime
    status: TaskStatus
    repeats_daily: bool
    completed_at: datetime | None
    completed_by: MemberOut | None

    @classmethod
    def from_task(cls, task) -> TaskOut:
        return cls.model_validate(
            {
                **{k: getattr(task, k) for k in ("id", "title", "category", "notes", "due_at",
                                                 "status", "completed_at")},
                "repeats_daily": task.schedule_id is not None,
                "completed_by": task.completed_by,
            }
        )


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    category: TaskCategory = TaskCategory.other
    notes: str | None = Field(default=None, max_length=2000)
    # A naive datetime ("2026-11-26T20:00") is read in the care recipient's timezone,
    # so a relative abroad adding "8 pm" means 8 pm where Mum is.
    due_at: datetime
    repeats_daily: bool = False


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    category: TaskCategory | None = None
    notes: str | None = Field(default=None, max_length=2000)
    due_at: datetime | None = None


class TodayOut(BaseModel):
    date: str
    timezone: str
    now: datetime
    overdue: list[TaskOut]
    due: list[TaskOut]
    done: list[TaskOut]


class Turn(BaseModel):
    """An earlier question and answer in the same conversation."""

    question: str = Field(max_length=500)
    answer: str = Field(max_length=2000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    # Earlier turns, oldest first, so follow-ups like "did she take it?" make sense.
    # The client keeps the conversation; the server stays stateless.
    history: list[Turn] = Field(default_factory=list, max_length=6)


class InteractionOut(ORM):
    id: int
    member_id: int | None
    question: str
    context: dict
    prompt: str | None
    answer: str
    provider: str
    model: str | None
    status: str
    error: str | None
    first_token_ms: int | None
    latency_ms: int | None
    feedback: int | None
    created_at: datetime


class FeedbackRequest(BaseModel):
    helpful: bool
