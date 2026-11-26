import { useEffect, useState } from "react";
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

  // A modal sheet: lock the page behind it and close on Escape.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

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

  const addButton = (
    <button className="add" onClick={() => setOpen(true)}>
      <span className="add__plus" aria-hidden>
        +
      </span>
      Add a task
    </button>
  );
  if (!open) return addButton;

  return (
    <>
      {addButton}
      <div className="backdrop" onClick={() => setOpen(false)}>
        <form
          className="sheet"
          onSubmit={submit}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-task-title"
        >
          <span className="sheet__grabber" aria-hidden />
          <div className="sheet__bar">
            <button type="button" className="link link--muted" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <h2 id="new-task-title" className="sheet__title">
              New task
            </h2>
            <span className="sheet__spacer" aria-hidden />
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

          <button className="btn btn--primary btn--block" disabled={saving || !title.trim()}>
            {saving ? "Saving…" : "Add task"}
          </button>
        </form>
      </div>
    </>
  );
}
