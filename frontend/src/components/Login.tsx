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
    <main className="auth">
      <span className="brand">CareCircle</span>
      <h1 className="auth__title">Sign in</h1>
      <p className="auth__lede">One shared list for looking after a parent, so the whole family knows what's done.</p>

      <form className="auth__form" onSubmit={(e) => void signIn(e)}>
        <label className="field">
          <span className="field__label">Email</span>
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
          <span className="field__label">Password</span>
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
        <button className="btn btn--primary btn--block" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <section className="auth__demo" aria-labelledby="demo-title">
        <h2 id="demo-title" className="section__title">
          Demo accounts
        </h2>
        <div className="group">
          {DEMO_ACCOUNTS.map((name) => {
            const demoEmail = `${name.toLowerCase()}@carecircle.demo`;
            return (
              <button
                key={name}
                type="button"
                className="account-row"
                disabled={busy}
                onClick={() => {
                  setEmail(demoEmail);
                  setPassword(DEMO_PASSWORD);
                  void signIn(undefined, { email: demoEmail, password: DEMO_PASSWORD });
                }}
              >
                <span className="avatar avatar--lg" aria-hidden>
                  {name[0]}
                </span>
                <span>
                  <span className="account-row__name">{name}</span>
                  <span className="account-row__email">{demoEmail}</span>
                </span>
                <span className="account-row__go">Sign in</span>
              </button>
            );
          })}
        </div>
        <p className="auth__foot">
          Tap an account, or use its email with the password <strong>{DEMO_PASSWORD}</strong>.
        </p>
      </section>
    </main>
  );
}
