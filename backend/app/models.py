from __future__ import annotations

import enum
from datetime import datetime, time

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class TaskCategory(str, enum.Enum):
    medicine = "medicine"
    appointment = "appointment"
    call = "call"
    other = "other"


class TaskStatus(str, enum.Enum):
    pending = "pending"
    done = "done"


class CareRecipient(Base):
    """The person being cared for. Their timezone defines what "today" means."""

    __tablename__ = "care_recipients"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    # How the family refers to them in conversation ("Mum", "Nani").
    display_name: Mapped[str] = mapped_column(String(50))
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")

    members: Mapped[list[FamilyMember]] = relationship(back_populates="recipient")


class FamilyMember(Base):
    __tablename__ = "family_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("care_recipients.id"))
    name: Mapped[str] = mapped_column(String(100))
    relation: Mapped[str | None] = mapped_column(String(50))
    # Login. Stored lower-cased; null means the member can't log in (yet).
    email: Mapped[str | None] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(200))

    recipient: Mapped[CareRecipient] = relationship(back_populates="members")


class TaskSchedule(Base):
    """A task that repeats every day at a local time (e.g. the 8 pm BP tablet).

    Concrete CareTask rows are created from schedules lazily, once per day, so a
    daily medicine is entered once rather than retyped each morning.
    """

    __tablename__ = "task_schedules"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("care_recipients.id"))
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[TaskCategory] = mapped_column(Enum(TaskCategory, name="task_category"))
    time_of_day: Mapped[time] = mapped_column(Time)  # in the recipient's timezone
    notes: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class CareTask(Base):
    __tablename__ = "care_tasks"
    # One instance per schedule per due time: makes daily materialisation idempotent.
    __table_args__ = (UniqueConstraint("schedule_id", "due_at", name="uq_task_schedule_due"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("care_recipients.id"), index=True)
    schedule_id: Mapped[int | None] = mapped_column(ForeignKey("task_schedules.id"))
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[TaskCategory] = mapped_column(Enum(TaskCategory, name="task_category"))
    notes: Mapped[str | None] = mapped_column(Text)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, name="task_status"), default=TaskStatus.pending
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by_id: Mapped[int | None] = mapped_column(ForeignKey("family_members.id"))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("family_members.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    completed_by: Mapped[FamilyMember | None] = relationship(foreign_keys=[completed_by_id])


class AIInteraction(Base):
    """Every "Ask about today" exchange, kept so the team can review and improve answers."""

    __tablename__ = "ai_interactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("care_recipients.id"))
    member_id: Mapped[int | None] = mapped_column(ForeignKey("family_members.id"))
    question: Mapped[str] = mapped_column(Text)
    # Exactly the structured facts the answer was built from (the day's tasks).
    context: Mapped[dict] = mapped_column(JSONB)
    # The full prompt sent to an LLM; null for the template provider.
    prompt: Mapped[str | None] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text, default="")
    provider: Mapped[str] = mapped_column(String(50))
    model: Mapped[str | None] = mapped_column(String(100))
    # "text" (typed) or "voice" (spoken; question is the transcript).
    channel: Mapped[str] = mapped_column(String(10), default="text", server_default="text")
    # Speech-to-text time for voice questions, so the whole voice round trip can be measured.
    stt_ms: Mapped[int | None] = mapped_column(Integer)
    # streaming | ok | fallback | error | client_disconnected
    status: Mapped[str] = mapped_column(String(30), default="streaming")
    error: Mapped[str | None] = mapped_column(Text)
    first_token_ms: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    # +1 / -1 from the "was this helpful?" buttons.
    feedback: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
