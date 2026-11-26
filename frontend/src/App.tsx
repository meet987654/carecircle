import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api";
import { AddTask } from "./components/AddTask";
import { AskBox } from "./components/AskBox";
import { Login } from "./components/Login";
import { TaskCard } from "./components/TaskCard";
import { fmtDay, fmtTime } from "./time";
import type { Member, NewTask, Recipient, Task, Today } from "./types";

const REFRESH_MS = 30_000; // pick up what other family members did

interface Toast {
  text: string;
  tone: "ok" | "info" | "error";
  undo?: () => void;
}

export default function App() {
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  // undefined = still checking the session, null = signed out.
  const [member, setMember] = useState<Member | null | undefined>(undefined);
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

  const signedOut = useCallback(() => {
    setMember(null);
    setRecipient(null);
    setToday(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setToday(await api.today());
      setOffline(false);
      setLastSync(Date.now());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) signedOut(); // session expired
      else setOffline(true);
    }
  }, [signedOut]);

  // Is there a session already (the cookie is httpOnly, so ask the server)?
  useEffect(() => {
    api
      .me()
      .then(setMember)
      .catch((err) => (err instanceof ApiError && err.status === 401 ? setMember(null) : setOffline(true)));
  }, []);

  // Once signed in, load the family and today's list.
  useEffect(() => {
    if (!member) return;
    api
      .recipient()
      .then(setRecipient)
      .catch(() => setOffline(true));
    void refresh();
  }, [member?.id, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  async function signOut() {
    await api.logout().catch(() => undefined);
    signedOut();
  }

  // Keep the list fresh: poll, refresh when the phone wakes up, tick relative times.
  useEffect(() => {
    if (!member) return;
    const poll = window.setInterval(() => void refresh(), REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [member, refresh]);

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
      await api.complete(task.id);
      showToast({ text: `Done: ${task.title}`, tone: "ok", undo: () => void undo(task) });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Someone else got there first; tell them who, don't treat it as an error.
        const winner = (err.body as { task?: Task })?.task;
        const by = winner?.completed_by?.name ?? "Someone";
        const at = winner?.completed_at ? ` at ${fmtTime(winner.completed_at, today.timezone)}` : "";
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
    await api.createTask(task);
    showToast({ text: `Added: ${task.title}`, tone: "ok" });
    await refresh();
  }

  if (member === null) return <Login onLogin={setMember} />;

  if (!member || !recipient || !today) {
    return (
      <main className="loading">
        <span className="brand">CareCircle</span>
        <p>{offline ? "Can't reach the server. Is it running?" : "Loading today…"}</p>
      </main>
    );
  }

  const tz = today.timezone;
  const total = today.overdue.length + today.due.length + today.done.length;
  const allDone = total > 0 && today.overdue.length === 0 && today.due.length === 0;
  const next = today.due[0];

  const sections = {
    overdue: { title: "Overdue", tasks: today.overdue, empty: "" },
    due: { title: "Up next", tasks: today.due, empty: "Nothing else is due today." },
    done: { title: "Done", tasks: today.done, empty: "Nothing has been marked done yet." },
  } as const;

  const renderSection = (key: keyof typeof sections) => {
    const s = sections[key];
    return (
      <section key={key} id={key} className={`section section--${key}`} aria-labelledby={`${key}-title`}>
        <div className="section__head">
          <h2 id={`${key}-title`} className="section__title">
            {s.title}
            <span className="count">{s.tasks.length}</span>
          </h2>
        </div>
        {s.tasks.length === 0 ? (
          key === "due" && allDone ? (
            <p className="empty empty--done">Everything is done for today.</p>
          ) : (
            <p className="empty">{s.empty}</p>
          )
        ) : (
          <ul className="group">
            {s.tasks.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                tone={key}
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
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">CareCircle</span>
        <button className="account" onClick={() => void signOut()} aria-label={`Signed in as ${member.name}. Sign out`}>
          <span className="avatar" aria-hidden>
            {member.name[0]}
          </span>
          {member.name}
          <span className="account__action">· Sign out</span>
        </button>
      </header>

      <section className="hero" aria-label="Summary">
        <p className="hero__date">{fmtDay(today.date)}</p>
        <h1 className="hero__title">{recipient.display_name}'s day</h1>
        <p className="hero__summary">
          {total === 0 ? (
            "Nothing is planned for today."
          ) : (
            <>
              <strong className="tnum">
                {today.done.length} of {total}
              </strong>{" "}
              done
              {today.overdue.length > 0 && (
                <>
                  {" · "}
                  <span className="late tnum">{today.overdue.length} overdue</span>
                </>
              )}
              {next && (
                <span className="hero__next">
                  Next: {next.title.split(" - ")[0]} at <span className="tnum">{fmtTime(next.due_at, tz)}</span>
                </span>
              )}
            </>
          )}
        </p>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={today.done.length}
          aria-label="Done today"
        >
          <span style={{ width: `${total ? (today.done.length / total) * 100 : 0}%` }} />
        </div>
      </section>

      {offline && (
        <div className="banner" role="status">
          You're offline. Showing the list from {lastSync ? fmtTime(new Date(lastSync).toISOString(), tz) : "earlier"}.
        </div>
      )}

      <main>
        {/* What a caregiver needs first: what's late, what's next, then the rest. */}
        {today.overdue.length > 0 && renderSection("overdue")}
        {renderSection("due")}
        <AddTask today={today.date} timeZone={tz} recipientName={recipient.display_name} onCreate={createTask} />
        <AskBox recipientName={recipient.display_name} />
        {renderSection("done")}
      </main>

      {toast && (
        <div className={`toast toast--${toast.tone}`} role="status" aria-live="polite">
          <span className="toast__text">{toast.text}</span>
          {toast.undo && (
            <button className="link" onClick={toast.undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
