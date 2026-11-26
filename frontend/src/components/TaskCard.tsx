import { Check, CircleAlert, Clock, Repeat, Undo2 } from "lucide-react";
import type { Task } from "../types";
import { fmtDay, fmtTime, localDate, relative } from "../time";
import { CategoryIcon } from "./CategoryIcon";

interface Props {
  task: Task;
  tone: "overdue" | "due" | "done";
  timeZone: string;
  today: string;
  now: number;
  busy: boolean;
  onDone: (task: Task) => void;
  onUndo: (task: Task) => void;
}

export function TaskCard({ task, tone, timeZone, today, now, busy, onDone, onUndo }: Props) {
  const dueDay = localDate(task.due_at, timeZone);
  const fromAnotherDay = dueDay !== today;
  const rel = relative(task.due_at, now);

  if (tone === "done") {
    const who = task.completed_by?.name ?? "Someone";
    return (
      <li className="task task--done">
        <span className="cat" aria-hidden>
          <Check size={22} strokeWidth={3} />
        </span>
        <div className="task__main">
          <div className="task__title">
            {fmtTime(task.due_at, timeZone)} · {task.title}
          </div>
          <div className="who">
            <span className="avatar" aria-hidden>{who[0]}</span>
            <span>
              <strong>{who}</strong>
              {task.completed_at && <> at {fmtTime(task.completed_at, timeZone)}</>}
            </span>
          </div>
        </div>
        <button className="btn btn--ghost undo-btn" onClick={() => onUndo(task)} disabled={busy} aria-label={`Undo ${task.title}`}>
          <Undo2 size={18} /> Undo
        </button>
      </li>
    );
  }

  return (
    <li className={`task task--${tone}`}>
      <div className="task__main">
        <div className="task__top">
          <CategoryIcon category={task.category} size={18} />
          <span className="task__time">{fmtTime(task.due_at, timeZone)}</span>
          {fromAnotherDay && <span className="task__day">{fmtDay(dueDay, true)}</span>}
          <span className={`badge badge--${tone === "overdue" ? "overdue" : rel === "due now" ? "now" : "due"}`}>
            {tone === "overdue" ? <CircleAlert size={14} strokeWidth={2.6} /> : <Clock size={14} strokeWidth={2.6} />}
            {rel}
          </span>
        </div>
        <div className="task__title">{task.title}</div>
        {task.notes && <div className="task__notes">{task.notes}</div>}
        {task.repeats_daily && (
          <div className="task__sub">
            <span>
              <Repeat size={14} strokeWidth={2.4} /> Every day
            </span>
          </div>
        )}
      </div>
      <button
        className={`btn done-btn ${tone === "overdue" ? "done-btn--urgent" : ""}`}
        onClick={() => onDone(task)}
        disabled={busy}
        aria-label={`Mark ${task.title} done`}
      >
        <Check size={22} strokeWidth={3} />
        Done
      </button>
    </li>
  );
}
