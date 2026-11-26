import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api";
import { AddTask } from "./components/AddTask";
import { AskBox } from "./components/AskBox";
import { MemberPicker } from "./components/MemberPicker";
import { TaskCard } from "./components/TaskCard";
import { fmtDay, fmtTime } from "./time";
import type { Member, NewTask, Recipient, Task, Today } from "./types";

const REFRESH_MS = 30_000; // pick up what other family members did
const MEMBER_KEY = "carecircle.memberId";

interface Toast {
  text: string;
  tone: "ok" | "info" | "error";
  undo?: () => void;
}

export default function App() {
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const [offline, setOffline] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const toastTimer = useRef<number>();

  const showToast = useCallback((t: Toast) => {
    window.clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = window.setTimeout(() => setToast(null), t.undo ? 7000 : 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setToday(await api.today());
      setOffline(false);
      setLastSync(Date.now());
    } catch {
      setOffline(true);
    }
  }, []);

  // Initial load + remember who is using this phone.
  useEffect(() => {
    api
      .recipient()
      .then((r) => {
        setRecipient(r);
        const saved = Number(localStorage.getItem(MEMBER_KEY));
        setMember(r.members.find((m) => m.id === saved) ?? null);
      })
      .catch(() => setOffline(true));
    void refresh();
  }, [refresh]);

  // Keep the list fresh: poll, refresh when the phone wakes up, tick relative times.
  useEffect(() => {
    const poll = window.setInterval(() => void refresh(), REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const setTaskBusy = (id: number, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      on ? next.add(id) : next.delete(id);
      return next;
    });

  async function markDone(task: Task) {
    if (!member || !today) return;
    setTaskBusy(task.id, true);
    // Optimistic: move it to Done straight away; the server is the source of truth after.
    const optimistic: Task = { ...task, status: "done", completed_by: member, completed_at: new Date().toISOString() };
    setToday({
      ...today,
      overdue: today.overdue.filter((t) => t.id !== task.id),
      due: today.due.filter((t) => t.id !== task.id),
      done: [optimistic, ...today.done],
    });
    try {
      await api.complete(task.id, member.id);
      showToast({ text: `Done: ${task.title}`, tone: "ok", undo: () => void undo(task) });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Someone else got there first; tell them who, don't treat it as an error.
        const winner = (err.body as { task?: Task })?.task;
        const by = winner?.completed_by?.name ?? "Someone";
        const at = winner?.completed_at && today ? ` at ${fmtTime(winner.completed_at, today.timezone)}` : "";
        showToast({ text: `${by} already did this${at}.`, tone: "info" });
      } else {
        showToast({ text: "Couldn't save. Please try again.", tone: "error" });
      }
    } finally {
      setTaskBusy(task.id, false);
      void refresh();
    }
  }

  async function undo(task: Task) {
    setTaskBusy(task.id, true);
    try {
      await api.reopen(task.id);
      setToast(null);
    } catch {
      showToast({ text: "Couldn't undo. Please try again.", tone: "error" });
    } finally {
      setTaskBusy(task.id, false);
      void refresh();
    }
  }

  async function createTask(task: NewTask) {
    await api.createTask({ ...task, created_by_id: member?.id });
    showToast({ text: `Added: ${task.title}`, tone: "ok" });
    await refresh();
  }

  if (!recipient || !today) {
    return (
      <main className="loading">
        {offline ? "Can't reach CareCircle. Is the server running?" : "Loading…"}
      </main>
    );
  }

  if (!member) {
    return (
      <MemberPicker
        members={recipient.members}
        recipientName={recipient.display_name}
        onPick={(m) => {
          localStorage.setItem(MEMBER_KEY, String(m.id));
          setMember(m);
        }}
      />
    );
  }

  const tz = today.timezone;
  const sections = [
    { key: "overdue", title: "Overdue", tasks: today.overdue, empty: "Nothing overdue." },
    { key: "due", title: "Still to do today", tasks: today.due, empty: "Nothing else due today." },
    { key: "done", title: "Done", tasks: today.done, empty: "Nothing marked done yet." },
  ] as const;

  const renderSection = (s: (typeof sections)[number]) => (
    <section key={s.key} id={s.key} className={`section section--${s.key}`}>
      <h2 className="section__title">
        {s.title} <span className="count">{s.tasks.length}</span>
      </h2>
      {s.tasks.length === 0 ? (
        <p className="empty">{s.empty}</p>
      ) : (
        <ul className="list">
          {s.tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              tone={s.key}
              timeZone={tz}
              today={today.date}
              now={now}
              busy={busy.has(t.id)}
              onDone={markDone}
              onUndo={undo}
            />
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>{recipient.display_name}'s day</h1>
          <p className="header__date">{fmtDay(today.date)}</p>
        </div>
        <button
          className="btn btn--ghost header__me"
          onClick={() => {
            localStorage.removeItem(MEMBER_KEY);
            setMember(null);
          }}
          aria-label={`You are ${member.name}. Switch person`}
        >
          <span className="avatar avatar--small" aria-hidden>{member.name[0]}</span>
          {member.name} · switch
        </button>
      </header>

      <nav className="summary" aria-label="Summary">
        <a href="#overdue" className={`summary__item summary__item--overdue ${today.overdue.length ? "" : "is-zero"}`}>
          <strong>{today.overdue.length}</strong> overdue
        </a>
        <a href="#due" className="summary__item summary__item--due">
          <strong>{today.due.length}</strong> to do
        </a>
        <a href="#done" className="summary__item summary__item--done">
          <strong>{today.done.length}</strong> done
        </a>
      </nav>

      {offline && (
        <div className="banner" role="status">
          Offline. Showing the list from {lastSync ? fmtTime(new Date(lastSync).toISOString(), tz) : "earlier"}.
        </div>
      )}

      <main>
        {/* Order = what a tired caregiver needs first: what's late, what's next, then the rest. */}
        {today.overdue.length > 0 && renderSection(sections[0])}
        {renderSection(sections[1])}
        <AddTask today={today.date} timeZone={tz} recipientName={recipient.display_name} onCreate={createTask} />
        <AskBox memberId={member.id} recipientName={recipient.display_name} />
        {renderSection(sections[2])}
      </main>

      {toast && (
        <div className={`toast toast--${toast.tone}`} role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.undo && (
            <button className="btn btn--toast" onClick={toast.undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
