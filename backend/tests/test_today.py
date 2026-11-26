"""The 'today' grouping and overdue rules (pure logic, no database)."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.models import CareTask, TaskCategory, TaskStatus
from app.services.today import group_today

IST = ZoneInfo("Asia/Kolkata")
GRACE = timedelta(minutes=15)


def at(hh: int, mm: int = 0, day: int = 26) -> datetime:
    """A wall-clock time in IST on Nov `day` 2026."""
    return datetime(2026, 11, day, hh, mm, tzinfo=IST)


def task(title: str, due: datetime, done_at: datetime | None = None) -> CareTask:
    return CareTask(
        title=title,
        category=TaskCategory.medicine,
        due_at=due,
        status=TaskStatus.done if done_at else TaskStatus.pending,
        completed_at=done_at,
    )


def titles(tasks):
    return [t.title for t in tasks]


def test_groups_overdue_due_and_done():
    now = at(10, 0)
    tasks = [
        task("8am BP", at(8)),                       # pending, 2h late
        task("9am Metformin", at(9), done_at=at(9, 5)),
        task("1pm call", at(13)),
        task("8pm BP", at(20)),
    ]
    g = group_today(tasks, now, IST, GRACE)
    assert titles(g.overdue) == ["8am BP"]
    assert titles(g.due) == ["1pm call", "8pm BP"]  # soonest first
    assert titles(g.done) == ["9am Metformin"]


def test_grace_period_keeps_just_due_task_out_of_overdue():
    tasks = [task("8am BP", at(8))]
    assert titles(group_today(tasks, at(8, 10), IST, GRACE).due) == ["8am BP"]
    assert titles(group_today(tasks, at(8, 16), IST, GRACE).overdue) == ["8am BP"]


def test_missed_task_from_yesterday_stays_overdue_today():
    yesterday_night = task("Yesterday 8pm BP", at(20, day=25))
    done_yesterday = task("Yesterday 9am", at(9, day=25), done_at=at(9, 5, day=25))
    tomorrow = task("Tomorrow 9am", at(9, day=27))
    g = group_today([yesterday_night, done_yesterday, tomorrow], at(7), IST, GRACE)
    assert titles(g.overdue) == ["Yesterday 8pm BP"]
    assert g.due == []  # tomorrow is not part of today
    assert g.done == []  # yesterday's completed work is not today's


def test_late_completion_of_yesterdays_task_counts_as_done_today():
    t = task("Yesterday 8pm BP", at(20, day=25), done_at=at(7, 30))
    assert titles(group_today([t], at(9), IST, GRACE).done) == ["Yesterday 8pm BP"]


def test_today_is_the_recipients_day_not_utc():
    # 01:30 IST on the 26th is still the 25th in UTC. A 23:00 IST task on the 26th
    # is due "today" for Mum even though, in UTC, it is on a different date.
    now = at(1, 30)
    assert now.astimezone(timezone.utc).day == 25
    g = group_today([task("Late night", at(23)), task("Next day", at(0, 30, day=27))], now, IST, GRACE)
    assert titles(g.due) == ["Late night"]
