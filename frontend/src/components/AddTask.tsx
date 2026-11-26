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
      <button className="add" onClick={() => setOpen(true)}>
        <span className="add__plus" aria-hidden>
          +
        </span>
        Add a task
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
    <form className="sheet" onSubmit={submit} aria-labelledby="new-task-title">
      <h2 id="new-task-title" className="sheet__title">
        New task
      </h2>

      <label className="field">
        <span className="field__label">What needs doing?</span>
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
        <legend className="field__label">Type</legend>
        <div className="segmented">
          {CATEGORIES.map((c) => (
            <button type="button" key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend className="field__label">
          Time <span className="field__hint">· {recipientName}'s local time</span>
        </legend>
        <div className="chips">
          {QUICK_TIMES.map((t) => (
            <button
              type="button"
              key={t.value}
              className="chip"
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

      <label className="switch">
        <span className="switch__text">
          <strong>Repeat every day</strong>
          <small>For daily medicines and calls</small>
        </span>
        <input type="checkbox" role="switch" checked={daily} onChange={(e) => setDaily(e.target.checked)} />
      </label>

      {error && <p className="error">{error}</p>}

      <div className="actions">
        <button type="button" className="btn btn--secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="btn btn--primary" disabled={saving || !title.trim()}>
          {saving ? "Saving…" : "Add task"}
        </button>
      </div>
    </form>
  );
}
