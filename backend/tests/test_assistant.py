"""The template assistant answers only from the day's facts."""

import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.models import CareRecipient, CareTask, FamilyMember, TaskCategory, TaskStatus
from app.services.assistant import TemplateProvider, build_context, compose_answer, fmt_time
from app.services.today import group_today

IST = ZoneInfo("Asia/Kolkata")


def at(hh, mm=0):
    return datetime(2026, 11, 26, hh, mm, tzinfo=IST)


def make_context(now=at(21, 0)):
    mum = CareRecipient(name="Kamala", display_name="Mum", timezone="Asia/Kolkata")
    ravi = FamilyMember(name="Ravi")
    priya = FamilyMember(name="Priya")
    tasks = [
        CareTask(title="BP tablet", category=TaskCategory.medicine, due_at=at(9),
                 status=TaskStatus.done, completed_at=at(9, 5), completed_by=ravi),
        CareTask(title="Metformin", category=TaskCategory.medicine, due_at=at(10),
                 status=TaskStatus.done, completed_at=at(10, 2), completed_by=priya),
        CareTask(title="BP tablet", category=TaskCategory.medicine, due_at=at(20),
                 status=TaskStatus.pending),
        CareTask(title="Call with Dr. Mehta", category=TaskCategory.call, due_at=at(22),
                 status=TaskStatus.pending),
    ]
    return build_context(mum, group_today(tasks, now, IST, timedelta(minutes=15)), now)


def test_fmt_time():
    assert fmt_time(at(8), IST) == "8 am"
    assert fmt_time(at(20, 30), IST) == "8:30 pm"
    assert fmt_time(at(0, 5), IST) == "12:05 am"


def test_answer_names_pending_dose_and_who_did_the_earlier_one():
    answer = compose_answer("Did Mum get her BP tablet?", make_context())
    assert answer.startswith("Ravi did the 9 am BP tablet at 9:05 am.")
    assert "8 pm BP tablet, 1 h late" in answer
    assert "Metformin" not in answer and "Call" not in answer  # only what was asked about


def test_category_question_covers_all_medicines():
    answer = compose_answer("Has Mum had her medicines?", make_context())
    assert "Ravi did the 9 am BP tablet" in answer and "Priya did the 10 am Metformin" in answer
    assert "Call" not in answer


def test_remaining_question_skips_done_items():
    answer = compose_answer("What's left?", make_context())
    assert "Ravi" not in answer
    assert "Next up is the 10 pm Call with Dr. Mehta" in answer


def test_empty_day():
    ctx = make_context()
    ctx.update(overdue=[], due=[], done=[])
    assert compose_answer("anything?", ctx) == "There is nothing on Mum's list for today."


def test_template_stream_reassembles_to_full_answer():
    ctx = make_context()

    async def collect():
        return [c async for c in TemplateProvider(chunk_delay=0).stream("status?", ctx)]

    chunks = asyncio.run(collect())
    assert len(chunks) > 3
    assert "".join(chunks) == compose_answer("status?", ctx)


def test_follow_up_keeps_the_subject_of_the_conversation():
    from app.services.assistant import resolve_followup

    ctx = make_context()
    first = "Did mom have any medicine to take today?"
    history = [{"question": first, "answer": compose_answer(first, ctx)}]

    follow_up = resolve_followup("Did she take it?", history, ctx)
    answer = compose_answer(follow_up, ctx)
    # Still about medicines: who gave them, and what's still pending. Not the call.
    assert "Ravi did the 9 am BP tablet" in answer and "Priya did the 10 am Metformin" in answer
    assert "8 pm BP tablet, 1 h late" in answer
    assert "Call" not in answer

    # A question that names its own subject is left alone.
    assert resolve_followup("Is the call done?", history, ctx) == "Is the call done?"
    # With no earlier subject there is nothing to carry over.
    assert resolve_followup("Did she take it?", [], ctx) == "Did she take it?"


def test_llm_gets_earlier_turns_as_chat_messages():
    from app.config import Settings
    from app.services.assistant import OpenAICompatibleProvider

    history = [{"question": "Any medicine today?", "answer": "Yes, BP tablet at 8 pm."}]
    messages = OpenAICompatibleProvider(Settings()).messages("Did she take it?", make_context(), history)
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "user"]
    assert "TODAY'S TASKS" in messages[0]["content"]
    assert messages[-1]["content"] == "Did she take it?"
