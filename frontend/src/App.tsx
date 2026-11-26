import { CalendarDays, Check, CircleAlert, HeartHandshake, Info, PartyPopper, WifiOff } from "lucide-react";
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

function greeting(timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <div className="ring" role="img" aria-label={`${done} of ${total} tasks done`}>
      <svg width="92" height="92" viewBox="0 0 92 92">
        <circle className="ring__track" cx="46" cy="46" r={r} fill="none" strokeWidth="8" />
        <circle
          className="ring__bar"
          cx="46"
          cy="46"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <div className="ring__label" aria-hidden>
        <strong>
          {done}/{total}
        </strong>
        <span>done</span>
      </div>
    </div>
  );
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
    await api.createTask({ ...task, created_by_id: member?.id });
    showToast({ text: `Added: ${task.title}`, tone: "ok" });
    await refresh();
  }

  if (!recipient || !today) {
    return (
      <main className="loading">
        {offline ? (
          <>
            <WifiOff size={36} />
            Can't reach CareCircle. Is the server running?
          </>
        ) : (
          <>
            <div className="spinner" />
            Loading today…
          </>
        )}
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
  const total = today.overdue.length + today.due.length + today.done.length;
  const allDone = total > 0 && today.overdue.length === 0 && today.due.length === 0;

  const sections = {
    overdue: { title: "Needs attention", hint: "Late — please check", tasks: today.overdue, empty: "" },
    due: { title: "Coming up today", hint: "Soonest first", tasks: today.due, empty: "Nothing else due today." },
    done: { title: "Done today", hint: "Latest first", tasks: today.done, empty: "Nothing marked done yet." },
  } as const;

  const renderSection = (key: keyof typeof sections) => {
    const s = sections[key];
    return (
      <section key={key} id={key} className={`section section--${key}`}>
        <div className="section__head">
          <h2 className="section__title">
            {key === "overdue" && <CircleAlert size={22} strokeWidth={2.6} />}
            {s.title} <span className="count">{s.tasks.length}</span>
          </h2>
          {s.tasks.length > 1 && <span className="section__hint">{s.hint}</span>}
        </div>
        {s.tasks.length === 0 ? (
          <p className="empty">
            {key === "due" && allDone ? (
              <>
                <PartyPopper size={22} /> All done for today. Lovely work.
              </>
            ) : (
              s.empty
            )}
          </p>
        ) : (
          <ul className="list">
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

  const ToastIcon = toast?.tone === "ok" ? Check : toast?.tone === "info" ? Info : CircleAlert;

  return (
    <div className="app">
      <header className="hero">
        <div className="hero__top">
          <span className="brand">
            <span className="brand__mark" aria-hidden>
              <HeartHandshake size={20} />
            </span>
            CareCircle
          </span>
          <button
            className="me"
            onClick={() => {
              localStorage.removeItem(MEMBER_KEY);
              setMember(null);
            }}
            aria-label={`You are ${member.name}. Switch person`}
          >
            <span className="avatar" aria-hidden>{member.name[0]}</span>
            {member.name} · Switch
          </button>
        </div>

        <div className="hero__body">
          <div>
            <p className="hero__greeting">
              {greeting(tz)}, {member.name}
            </p>
            <h1 className="hero__title">{recipient.display_name}'s day</h1>
            <p className="hero__date">
              <CalendarDays size={16} /> {fmtDay(today.date)}
            </p>
          </div>
          <ProgressRing done={today.done.length} total={total} />
        </div>

        <nav className="stats" aria-label="Summary">
          <a href="#overdue" className={`stat stat--overdue ${today.overdue.length ? "is-hot" : ""}`}>
            <strong>
              <i className="stat__dot" /> {today.overdue.length}
            </strong>
            <span>Overdue</span>
          </a>
          <a href="#due" className="stat stat--due">
            <strong>
              <i className="stat__dot" /> {today.due.length}
            </strong>
            <span>To do</span>
          </a>
          <a href="#done" className="stat stat--done">
            <strong>
              <i className="stat__dot" /> {today.done.length}
            </strong>
            <span>Done</span>
          </a>
        </nav>
      </header>

      {offline && (
        <div className="banner" role="status">
          <WifiOff size={18} />
          Offline · showing the list from {lastSync ? fmtTime(new Date(lastSync).toISOString(), tz) : "earlier"}
        </div>
      )}

      <main>
        {/* Order = what a tired caregiver needs first: what's late, what's next, then the rest. */}
        {today.overdue.length > 0 && renderSection("overdue")}
        {renderSection("due")}
        <AddTask today={today.date} timeZone={tz} recipientName={recipient.display_name} onCreate={createTask} />
        <AskBox memberId={member.id} recipientName={recipient.display_name} />
        {renderSection("done")}
      </main>

      {toast && (
        <div className={`toast toast--${toast.tone}`} role="status" aria-live="polite">
          <span className="toast__icon" aria-hidden>
            <ToastIcon size={18} strokeWidth={2.8} />
          </span>
          <span className="toast__text">{toast.text}</span>
          {toast.undo && (
            <button className="btn toast__undo" onClick={toast.undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
