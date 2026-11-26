import { CircleAlert, Plus, Repeat, X } from "lucide-react";
import { useState } from "react";
import type { Category, NewTask } from "../types";
import { nextQuarterHour } from "../time";
import { CATEGORY_LABEL, CategoryIcon } from "./CategoryIcon";

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
        <span className="add-btn__icon" aria-hidden>
          <Plus size={20} strokeWidth={3} />
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
    <form className="panel" onSubmit={submit}>
      <div className="panel__head">
        <div>
          <h2 className="panel__title">
            <span className="panel__icon" aria-hidden>
              <Plus size={20} strokeWidth={2.6} />
            </span>
            New task
          </h2>
        </div>
        <button type="button" className="btn btn--ghost icon-close" onClick={() => setOpen(false)} aria-label="Close">
          <X size={20} />
        </button>
      </div>

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
        <legend>Type</legend>
        <div className="tiles">
          {CATEGORIES.map((c) => (
            <button
              type="button"
              key={c}
              className={`tile ${category === c ? "tile--on" : ""}`}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              <CategoryIcon category={c} size={18} />
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Time · {recipientName}'s time</legend>
        <div className="times">
          {QUICK_TIMES.map((t) => (
            <button
              type="button"
              key={t.value}
              className={`time-chip ${time === t.value ? "time-chip--on" : ""}`}
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
          <Repeat size={20} aria-hidden />
          <span>
            Repeat every day
            <small>For daily medicines and calls</small>
          </span>
        </span>
        <input type="checkbox" role="switch" checked={daily} onChange={(e) => setDaily(e.target.checked)} />
      </label>

      {error && (
        <p className="error">
          <CircleAlert size={18} /> {error}
        </p>
      )}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="btn btn--primary" disabled={saving || !title.trim()}>
          {saving ? "Saving…" : "Add task"}
        </button>
      </div>
    </form>
  );
}
