import type { Task } from "../types";
import { fmtDay, fmtTime, localDate, relative } from "../time";

const ICON: Record<Task["category"], string> = {
  medicine: "💊",
  appointment: "🩺",
  call: "📞",
  other: "📝",
};

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

  return (
    <li className={`card card--${tone}`}>
      <div className="card__icon" aria-hidden>
        {tone === "done" ? "✅" : ICON[task.category]}
      </div>
      <div className="card__body">
        <div className="card__time">
          {fmtTime(task.due_at, timeZone)}
          {fromAnotherDay && <span className="card__day"> · {fmtDay(dueDay, true)}</span>}
        </div>
        <div className="card__title">{task.title}</div>
        {task.notes && <div className="card__notes">{task.notes}</div>}
        {tone === "done" ? (
          <div className="card__meta">
            <span>
              Done by <strong>{task.completed_by?.name ?? "someone"}</strong>
              {task.completed_at && <> at {fmtTime(task.completed_at, timeZone)}</>}
            </span>
          </div>
        ) : (
          <div className={`card__meta card__meta--${tone}`}>
            {relative(task.due_at, now)}
            {task.repeats_daily && <span className="pill">every day</span>}
          </div>
        )}
      </div>
      <div className="card__action">
        {tone === "done" ? (
          <button className="btn btn--ghost" onClick={() => onUndo(task)} disabled={busy}>
            Undo
          </button>
        ) : (
          <button
            className={`btn btn--done ${tone === "overdue" ? "btn--urgent" : ""}`}
            onClick={() => onDone(task)}
            disabled={busy}
            aria-label={`Mark ${task.title} done`}
          >
            {busy ? "…" : "Done"}
          </button>
        )}
      </div>
    </li>
  );
}
