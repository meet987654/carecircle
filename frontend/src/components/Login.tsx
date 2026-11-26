import { useState } from "react";
import { ApiError, api } from "../api";
import type { Member } from "../types";

interface Props {
  onLogin: (member: Member) => void;
}

// Seeded demo accounts (backend/app/seed.py), listed so reviewers can sign in with one tap.
const DEMO_PASSWORD = "carecircle";
const DEMO_ACCOUNTS = ["Ravi", "Priya", "Anil"];

export function Login({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e?: React.FormEvent, creds = { email, password }) {
    e?.preventDefault();
    if (!creds.email.trim() || !creds.password) return;
    setBusy(true);
    setError(null);
    try {
      const { member } = await api.login(creds.email.trim(), creds.password);
      onLogin(member);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? err.message : "Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="picker">
      <span className="wordmark">
        Care<b>Circle</b>
      </span>
      <span className="label">Welcome back</span>
      <h1 className="display">Sign in</h1>
      <p>So the family can see who looked after whom, and when.</p>

      <form className="login" onSubmit={(e) => void signIn(e)}>
        <label className="field">
          <span className="label">Email</span>
          <input
            className="input"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--primary login__submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <section className="demo" aria-labelledby="demo-title">
        <span id="demo-title" className="label">
          Demo accounts
        </span>
        <div className="picker__list">
          {DEMO_ACCOUNTS.map((name) => {
            const demoEmail = `${name.toLowerCase()}@carecircle.demo`;
            return (
              <button
                key={name}
                type="button"
                className="member"
                disabled={busy}
                onClick={() => {
                  setEmail(demoEmail);
                  setPassword(DEMO_PASSWORD);
                  void signIn(undefined, { email: demoEmail, password: DEMO_PASSWORD });
                }}
              >
                <span className="initial" aria-hidden>
                  {name[0]}
                </span>
                <span>
                  <span className="member__name">{name}</span>
                  <span className="member__rel">{demoEmail}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="picker__foot">
          Tap a name to sign in, or use its email with the password <strong>{DEMO_PASSWORD}</strong>.
        </p>
      </section>
    </main>
  );
}
