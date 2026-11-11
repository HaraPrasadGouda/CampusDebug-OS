# AGENTS.md — rules for AI coding agents working in this repo

Project: **CampusDebug OS** — offline-first college operations PWA.
Stack: React 19 + Vite frontend (`src/`), Express 5 backend (`server.js`),
Supabase (PostgreSQL) with a disk-ledger JSON fallback so nothing is lost
offline. Node's built-in test runner (`node:test`) with a custom harness.

## Non-negotiable rules

### 1. Tests ship with features
- Every new API endpoint or logic feature must come with its own test file:
  `test/<feature-name>.test.mjs`
- Build tests on the existing harness: `import { startApp } from './harness.mjs'`.
  It spins up a mock Supabase on localhost + the REAL `server.js` with an
  injectable fake clock. NEVER touch the real database or the real `.env`.
- Use the harness helpers:
  - `app.api(method, path, roll, body)` — authenticated HTTP call as any user roll
  - `app.clock('HH:MM')` — move the fake clock (time-travel for expiry tests)
  - `app.stop()` — always call in a `finally` block (kills mock + server,
    wipes the scratch data folder)
- Test file names MUST end in `.test.mjs` or `npm test` will ignore them.

### 2. Verify before claiming done
- A feature is NOT done until: (a) its test file exists, (b) `npm test`
  passes with zero failures.
- Actually run `npm test` and report the result. Never say "done" based on
  assumed behavior.

### 3. Never weaken existing tests
- If an existing test fails after a change: first treat it as a real bug and
  fix the code. Only update a test when the user explicitly confirms the
  behavior change is intentional — and then say which test changed and why.

### 4. Follow the house style
- Match existing patterns in `server.js` and `src/`: naming, comment style
  (comments explain WHY, not what), error handling, and the dual-write
  persistence rule (Supabase first, disk-ledger fallback, merge + dedupe on
  read) so offline-created data is never lost.

### 5. End-of-task report format
- What was added/changed (files + one-line description each)
- New test file created: yes/no + name
- `npm test` result: X passed, Y failed
- Anything the user should manually verify in the UI

## Commands

- `npm run dev` — Vite dev server (frontend)
- `npm run server` — the Express backend (`server.js`)
- `npm test` — full automated test suite (mock Supabase, fake clock, no real DB)
