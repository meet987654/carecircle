import type { Category, Task } from "../types";
import { fmtDay, fmtTime, localDate, relative } from "../time";

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

/** One row of a grouped list: [check] [title + details] [time + status]. */
export function TaskCard({ task, tone, timeZone, today, now, busy, onDone, onUndo }: Props) {
  const dueDay = localDate(task.due_at, timeZone);

  if (tone === "done") {
    return (
      <li className="row row--done">
        <span className="check check--done" aria-hidden />
        <div>
          <p className="row__title">{task.title}</p>
          <p className="row__meta">
            <strong>{task.completed_by?.name ?? "Someone"}</strong>
            {task.completed_at && <span className="tnum"> · {fmtTime(task.completed_at, timeZone)}</span>}
            <span className="tnum"> · due {fmtTime(task.due_at, timeZone)}</span>
          </p>
        </div>
        <button className="link" onClick={() => onUndo(task)} disabled={busy} aria-label={`Undo ${task.title}`}>
          Undo
        </button>
      </li>
    );
  }

  const rel = relative(task.due_at, now);
  const status = tone === "overdue" ? "late" : rel === "due now" ? "now" : "upcoming";
  const meta = [
    CATEGORY_LABEL[task.category],
    task.repeats_daily ? "Daily" : null,
    dueDay !== today ? fmtDay(dueDay, true) : null,
    task.notes,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className={`row row--${tone}`}>
      <button className="check" onClick={() => onDone(task)} disabled={busy} aria-label={`Mark ${task.title} done`} />
      <div>
        <p className="row__title">{task.title}</p>
        <p className="row__meta">{meta}</p>
      </div>
      <p className="row__time">
        <span className="row__clock">{fmtTime(task.due_at, timeZone)}</span>
        <span className={`row__status row__status--${status}`}>{rel === "due now" ? "Due now" : rel}</span>
      </p>
    </li>
  );
}
