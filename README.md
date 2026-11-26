# CareCircle Lite

A shared place where one family coordinates an aging parent's day: what's overdue, what's next,
who did what and when, plus a streaming "Ask about today" assistant.

**Stack:** FastAPI · PostgreSQL · SQLAlchemy 2 · React + TypeScript (Vite) · SSE · Docker Compose

## Run it

```bash
docker compose up --build
```

| What | URL |
| --- | --- |
| App (use your phone's browser or DevTools' mobile view) | http://localhost:3000 |
| API docs (Swagger) | http://localhost:8000/docs |
| AI interaction log (sign in first) | http://localhost:8000/api/assistant/interactions |

On first start the API creates the tables and seeds a demo family: Mum (Asia/Kolkata), Ravi, Priya, Anil,
five daily routines (BP tablets, Metformin, a check-in call, a walk) and a one-off doctor's appointment.
Sign in as one of them (the login screen lists the demo accounts, tap one), then tap **Done** on anything.

| Demo login | Password |
| --- | --- |
| `ravi@carecircle.demo`, `priya@carecircle.demo`, `anil@carecircle.demo` | `carecircle` |

**Tests** (19, against a real Postgres):

```bash
docker compose run --rm api pytest -v
```

or locally: `docker compose up -d db`, then `cd backend && pip install -r requirements.txt && pytest`.
CI runs the same tests and the frontend type-check/build on every push (`.github/workflows/ci.yml`).

**Optional LLM:** the assistant works with no API key. To use Groq or a local Ollama model instead,
copy `.env.example` to `.env`, uncomment one block and run `docker compose up` again. If the LLM fails
before sending anything, the answer falls back to the template, and the log records why.

**Frontend dev with hot reload:** `docker compose up db api`, then `cd frontend && npm install && npm run dev`
(http://localhost:5173, proxies `/api` to :8000).

## What's in it

### Must-haves
1. **Data model:** `care_recipients`, `family_members`, `care_tasks` (category, `due_at`, status,
   `completed_by`, `completed_at`), `task_schedules` (daily repeats), `ai_interactions`.
2. **REST:** `POST /api/auth/login|logout`, `GET /api/auth/me`, `GET /api/today`, `GET|POST /api/tasks`, `PATCH|DELETE /api/tasks/{id}`,
   `POST /api/tasks/{id}/complete`, `POST /api/tasks/{id}/reopen`, `GET /api/recipient`.
3. **Today screen:** overdue / still to do / done, one-tap Done that records who and when, an inline Add-task form.
4. **Streaming assistant:** `POST /api/assistant/ask` returns `text/event-stream` (`meta` → `token`… → `done`).
5. **AI log:** every question is stored with the exact context the assistant saw, the prompt (for LLMs),
   the answer, provider/model, status, **time to first token** and **total latency**, plus 👍/👎 feedback.
6. **One command:** `docker compose up`.
7. **Tests:** grouping and overdue rules, timezone boundaries, assistant wording, the API flow,
   concurrent completion, SSE + logging, and LLM fallback.

### Nice-to-haves I picked
- **Two people tapping Done at once:** handled at the database level (see below), with a friendly
  "Priya already did this at 8:04 pm" in the UI, plus a test that fires 8 simultaneous taps.
- **Login:** email + password per family member. "Done by" is taken from the session, so nobody can
  record a dose in someone else's name (see below).
- **Voice input:** a Speak button on the Ask box (Web Speech API; hidden on browsers without it).

## Design choices and why

**"Today" is the parent's day, not the server's or the viewer's.** The care recipient has a timezone, and
"today", the times shown and the times you type all use it. A son in London adding "8 pm" means 8 pm for
Mum in Pune. Timestamps are stored as `timestamptz` (UTC). A naive datetime sent to the API is
read in the recipient's timezone. There's a test for the IST/UTC midnight boundary.

**Overdue rules** (`backend/app/services/today.py`, a pure function, so it's easy to test):
- *overdue* = pending and more than 15 min past due (`OVERDUE_GRACE_MINUTES`), so the list doesn't
  turn red the minute the 8:00 tablet is due.
- Pending tasks from **earlier days stay overdue**. A missed dose from last night shouldn't quietly
  disappear at midnight.
- *done* = completed tasks that were due today **or** completed today (yesterday's late dose given this
  morning shows up).

**Mark-done is one atomic conditional UPDATE** (`UPDATE … SET status='done' WHERE id=? AND status='pending'
RETURNING id`). If two people tap together, Postgres lets exactly one write through. The other gets a
`409` with the winner's name and time, so the record of who gave the medicine is never silently
overwritten. I chose this over optimistic version numbers because there's only one state change
that matters and the database already guarantees it.

**Daily repeats are schedules that turn into rows lazily.** Most care tasks are routines, and retyping the BP
tablet every morning is exactly the chore this app should remove. Each `task_schedule` gets one real
`care_task` per day, created the first time anyone opens Today (`INSERT … ON CONFLICT DO NOTHING` on
`(schedule_id, due_at)`, so it's idempotent under concurrent requests). There's no cron job to run, and
each day's completion is its own row with its own history.

**Assistant: grounded first, LLM optional.** The answer is built only from a small JSON context
(the day's overdue/due/done tasks with who and when). That same JSON is what gets logged, so a reviewer
sees exactly what the assistant saw. The default **template provider** narrows to what was asked about
(a named task like "BP tablet" first, then a category like "medicines"), puts who-did-what first for
"who/did" questions, and never invents anything. An **OpenAI-compatible provider** (Groq, Ollama, OpenAI)
gets the same context with a strict system prompt. Both stream through the same SSE path. The template
streams word by word, so the UI behaves the same either way.

**SSE over POST, read with `fetch`**, rather than `EventSource` (GET-only) or WebSockets (two-way, which this
doesn't need). nginx has `proxy_buffering off` so tokens aren't held back. The log row is written at the
start (its id goes to the client for feedback) and finished in a `finally`, so errors and
client disconnects are recorded too (`status`: ok / fallback / error / client_disconnected).

**Login is small but real.** Passwords are hashed with scrypt (salted). A session is a signed token
(`member_id.expiry.HMAC-SHA256`, `AUTH_SECRET`), so there's no session table and a tampered or expired token
is rejected. It's stored in an **httpOnly, SameSite=Lax cookie**: page scripts can't read it and other sites
can't make the browser send it on a POST. The SSE `fetch` sends it automatically. A Bearer header works too,
for API clients. A wrong email and a wrong password get the same message and take the same time. Every
endpoint except login and health needs a session, and **the family comes from the logged-in member**, so all
queries (including the AI log) are scoped to that family. Both the completer and the asker come from the
session, never from the request body. All standard library, no new dependencies.

**UI for a tired caregiver on a phone:** 18px base text, 56px+ tap targets, and every state shown in both
colour and words ("2 h 10 min late", "Done by Ravi at 9:07 am"). Overdue comes first and only appears
when non-empty. No menus or modals: the add form opens inline, and who you are (with sign out) is always visible.
Done is **optimistic** with a 7-second **Undo**, because mis-taps happen at 6 am. The list refreshes every 30 s
and when the phone wakes, so you see what the others did. If the connection drops, a banner shows how
old the list is.

## Assumptions
- **Each member belongs to one family** (care recipient). Every query is scoped to the logged-in member's
  family. Caring for two parents would mean a member↔recipient join table.
- **Accounts are created by seeding**, not by sign-up. Inviting a family member is the obvious next step.
- No login rate limiting or password reset yet (see below). Keep `AUTH_SECRET` secret and set
  `COOKIE_SECURE=true` behind HTTPS.
- Only `pending` and `done` statuses. "Skipped" or "refused" would be the next status worth adding (see below).
- Schema is created with `create_all` on startup. A real deployment would use Alembic migrations.

## What I'd do next with more time
1. **Easier, safer sign-in for families:** invite links, magic link or phone OTP via WhatsApp instead of
   passwords, login rate limiting, and roles (e.g. a paid carer who can mark done but not delete).
2. **Skipped / refused with a reason** ("Mum refused the evening tablet, felt dizzy"), which is often the most
   important thing the family needs to know.
3. **Push notifications** when something becomes overdue, to whoever is on duty, plus live updates over SSE
   instead of polling.
4. **Use the AI log**: a small review page, turning 👎 answers into regression cases for the template and the
   prompt, and an eval set run in CI.
5. Alembic migrations, editing and pausing schedules from the UI, a weekly history view, an offline queue for taps.

## AI tools used
- **Claude Code:** used throughout as a pair programmer for scaffolding, backend and frontend code, tests,
  Docker/CI config, and UI iteration (checked with headless-browser screenshots). I directed the design
  and reviewed the output. The decisions above (timezone semantics, overdue rules, atomic completion, lazy
  schedules, grounded assistant) are mine to defend and change.

## Time spent
About 3–4 hours.

## Layout
```
backend/app/
  services/today.py      "today" + overdue rules (pure, unit-tested)
  services/tasks.py      queries, daily schedules, atomic complete
  services/assistant.py  context builder, template answer, LLM provider
  auth.py                password hashing, signed session tokens, current_member
  routers/               REST + SSE endpoints
backend/tests/           pytest (pure logic + API against Postgres)
frontend/src/            App, Login, TaskCard, AddTask, AskBox (SSE reader + voice)
docker-compose.yml       db + api + web (nginx)
```
