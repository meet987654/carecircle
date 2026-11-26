"""What "today" means for a care recipient, and how tasks are bucketed.

Kept free of database access so the rules are easy to read and unit-test.

Rules:
- "Today" is the calendar day in the *care recipient's* timezone, not the server's
  or the viewer's. A son in London looking at Mum's day in Pune sees Pune's day.
- overdue: pending and more than `grace` past its due time. This includes pending
  tasks from earlier days: a missed tablet yesterday should not silently vanish.
- due: pending, due later today or within the grace window.
- done: completed tasks that were due today or completed today.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.models import CareTask, TaskStatus


def local_day_bounds(now: datetime, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """Start (inclusive) and end (exclusive) of `now`'s local day, as aware datetimes."""
    local_date = now.astimezone(tz).date()
    return day_bounds(local_date, tz)


def day_bounds(local_date: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime.combine(local_date, time.min, tzinfo=tz)
    end = datetime.combine(local_date + timedelta(days=1), time.min, tzinfo=tz)
    return start, end


@dataclass
class TodayGroups:
    overdue: list[CareTask] = field(default_factory=list)
    due: list[CareTask] = field(default_factory=list)
    done: list[CareTask] = field(default_factory=list)


def group_today(
    tasks: Iterable[CareTask], now: datetime, tz: ZoneInfo, grace: timedelta
) -> TodayGroups:
    start, end = local_day_bounds(now, tz)
    groups = TodayGroups()

    for task in tasks:
        if task.status == TaskStatus.done:
            due_today = start <= task.due_at < end
            done_today = task.completed_at is not None and start <= task.completed_at < end
            if due_today or done_today:
                groups.done.append(task)
        elif task.due_at + grace < now:
            groups.overdue.append(task)
        elif task.due_at < end:
            groups.due.append(task)
        # else: pending but due on a future day -> not part of today

    groups.overdue.sort(key=lambda t: t.due_at)  # most late first
    groups.due.sort(key=lambda t: t.due_at)  # soonest first
    groups.done.sort(key=lambda t: t.completed_at or t.due_at, reverse=True)  # latest first
    return groups
