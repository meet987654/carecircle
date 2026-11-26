import { useState } from "react";
import type { Category, NewTask } from "../types";
import { nextQuarterHour } from "../time";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "medicine", label: "💊 Medicine" },
  { value: "appointment", label: "🩺 Appointment" },
  { value: "call", label: "📞 Call" },
  { value: "other", label: "📝 Other" },
];

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
      <button className="btn btn--add" onClick={() => setOpen(true)}>
        + Add a task
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
    <form className="add" onSubmit={submit}>
      <h2 className="section__title">New task for today</h2>

      <label className="field">
        <span>What needs doing?</span>
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
        <div className="segmented">
          {CATEGORIES.map((c) => (
            <button
              type="button"
              key={c.value}
              className={`segment ${category === c.value ? "segment--on" : ""}`}
              aria-pressed={category === c.value}
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Time ({recipientName}'s time)</legend>
        <div className="segmented">
          {QUICK_TIMES.map((t) => (
            <button
              type="button"
              key={t.value}
              className={`segment ${time === t.value ? "segment--on" : ""}`}
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

      <label className="check">
        <input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} />
        <span>Repeat every day</span>
      </label>

      {error && <p className="error">{error}</p>}

      <div className="add__actions">
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
