import type { Category, Task } from "../types";
import { fmtDay, fmtTime, localDate, relative, timeParts } from "../time";

export const CATEGORY_LABEL: Record<Category, string> = {
  medicine: "Medicine",
  appointment: "Appointment",
  call: "Call",
  other: "Other",
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

  if (tone === "done") {
    return (
      <li className="task task--done">
        <div>
          <p className="task__title">
            <span className="num">{fmtTime(task.due_at, timeZone)}</span>
            {task.title}
          </p>
          <p className="task__who">
            Done by <strong>{task.completed_by?.name ?? "someone"}</strong>
            {task.completed_at && <span className="num"> at {fmtTime(task.completed_at, timeZone)}</span>}
          </p>
        </div>
        <button className="btn btn--quiet btn--undo" onClick={() => onUndo(task)} disabled={busy} aria-label={`Undo ${task.title}`}>
          Undo
        </button>
      </li>
    );
  }

  const { clock, period } = timeParts(task.due_at, timeZone);
  const rel = relative(task.due_at, now);
  const statusTone = tone === "overdue" ? "overdue" : rel === "due now" ? "now" : "due";
  const kicker = [CATEGORY_LABEL[task.category], task.repeats_daily ? "Daily" : null].filter(Boolean).join(" · ");

  return (
    <li className={`task task--${tone} cat-${task.category}`}>
      <div>
        <span className="label kicker">{kicker}</span>
        <div className="task__when">
          <span className="task__clock">{clock}</span>
          <span className="task__period">{period}</span>
          {dueDay !== today && <span className="task__day">{fmtDay(dueDay, true)}</span>}
        </div>
        <p className="task__title">{task.title}</p>
        {task.notes && <p className="task__notes">{task.notes}</p>}
        <p className={`task__status task__status--${statusTone}`}>{rel === "due now" ? "Due now" : rel}</p>
      </div>
      <button className="btn btn--done" onClick={() => onDone(task)} disabled={busy} aria-label={`Mark ${task.title} done`}>
        {busy ? "…" : "Done"}
      </button>
    </li>
  );
}
