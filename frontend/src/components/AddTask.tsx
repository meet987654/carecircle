import { useState } from "react";
import type { Category, NewTask } from "../types";
import { nextQuarterHour } from "../time";
import { CATEGORY_LABEL } from "./TaskCard";

const CATEGORIES: Category[] = ["medicine", "appointment", "call", "other"];

const QUICK_TIMES = [
  { label: "8 am", value: "08:00" },
  { label: "1 pm", value: "13:00" },
  { label: "8 pm", value: "20:00" },
];

interface Props {
  today: string; // recipient's local date
  timeZone: string;
  recipientName: string;
  onCreate: (task: NewTask) => Promise<void>;
}

export function AddTask({ today, timeZone, recipientName, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("medicine");
  const [time, setTime] = useState(() => nextQuarterHour(timeZone));
  const [daily, setDaily] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="btn add-btn" onClick={() => setOpen(true)}>
        Add a task
        <span className="plus" aria-hidden>+</span>
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({ title: title.trim(), category, due_at: `${today}T${time}`, repeats_daily: daily });
      setTitle("");
      setDaily(false);
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <span className="label">New task</span>
      <h2 className="panel__title display">What needs doing?</h2>
      <p className="panel__sub">It will show up for everyone in the family.</p>

      <label className="field">
        <span className="label">Task</span>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. BP tablet, Dr. Mehta visit"
          autoFocus
          required
          maxLength={200}
        />
      </label>

      <fieldset className="field">
        <legend className="label">Type</legend>
        <div className="options">
          {CATEGORIES.map((c) => (
            <button
              type="button"
              key={c}
              className={`option cat-${c}`}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend className="label">Time · {recipientName}'s clock</legend>
        <div className="options">
          {QUICK_TIMES.map((t) => (
            <button
              type="button"
              key={t.value}
              className="option option--time"
              aria-pressed={time === t.value}
              onClick={() => setTime(t.value)}
            >
              {t.label}
            </button>
          ))}
          <input
            className="input input--time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label="Exact time"
            required
          />
        </div>
      </fieldset>

      <label className="toggle">
        <span>
          <strong>Repeat every day</strong>
          <small>For daily medicines and calls</small>
        </span>
        <input type="checkbox" role="switch" checked={daily} onChange={(e) => setDaily(e.target.checked)} />
      </label>

      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn btn--quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="btn btn--primary" disabled={saving || !title.trim()}>
          {saving ? "Saving…" : "Add task"}
        </button>
      </div>
    </form>
  );
}
