---
title: 'Keep Reception Database Warm During Active Conversations'
type: 'feature'
ticket: ''
created: '2026-10-06'
status: 'built'
baseline_revision: 'f4e932ebc5d350cd26473e1b2711b65ba8e9191c'
route: 'full'
route_source: 'pinned'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['AGENTS.md']
---

<frozen-after-approval reason="The user asked that the database be active when a session begins to avoid mid-conversation idle delays, and explicitly requested full testing, push, deploy, and live verification. Standing project guidance delegates routine implementation decisions.">

## Intent

**Problem:** Creating a reception session already writes to and reads from Netlify Database before Gemini Live connects, but Netlify Personal databases can sleep after five minutes without activity. A longer conversation can therefore encounter a cold database on a later doctor or appointment lookup.

**Approach:** Reuse the existing session-start database activity, then issue a lightweight read-only keep-warm request during recent conversation activity. Stop it on hang-up, terminal failure, disconnection, or extended caller inactivity; resume it when the caller speaks again.

## Boundaries & Constraints

**Always:** Never write domain data for a keep-warm request; limit it to a session-existence query; use the same request diagnostics without IDs or personal data; use one in-flight ping maximum; keep ping failures best-effort so they cannot break voice or text conversation; preserve reconnect and session-close semantics.

**Never:** Do not change database sleep settings, add scheduled jobs, poll full snapshots, keep the database awake when no recent caller activity exists, add booking changes, or modify production appointments while testing. Do not run `db:reset`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Session start | New or restored active session | Existing DB work completes before Gemini opens; heartbeat timer is armed | Existing connect failure behavior is preserved |
| Ongoing conversation | Recent text or microphone turn; active session | One read-only ping at most every two minutes | Ping failure is swallowed and does not change session state |
| Extended silence | No new caller turn for four minutes | Heartbeat stops; next caller turn restarts it and sends a throttled best-effort ping | No background pings while inactive |
| End/disconnect/error | Explicit end, disposal, terminal error, or reconnect attempt | Timer is stopped; successful reconnect resumes only if recent caller activity remains | No duplicate timer or overlapping ping |
| Unknown session | Keep-warm route targets a missing session | 404 from the existing lightweight session guard | No snapshot or data writes |

</frozen-after-approval>

## Code Map

- `src/client/voice/receptionSession.ts` -- active session lifecycle, `connect`, `sendText`, `beginMicrophoneTurn`, `disconnected`, `stop`, and terminal-state handling; own the activity timestamp, capped-idle timer, single-flight ping, and cleanup here. Do not refresh activity for every audio chunk because silence also produces chunks.
- `src/server/reception/routes.ts` -- `hasSession` guard already issues `SELECT 1`; add a session keep-warm route after that guard and map it to a normalized diagnostic path. Do not call `getSnapshot` or a write endpoint.
- `tests/client/reception-session.test.ts` -- existing controller harness; add fake-timer coverage for ping cadence, inactivity stop/restart, reconnect/stop cleanup, and non-blocking failures.
- `tests/server/reception-routes.test.ts` -- route fixture/query counter; assert one `SELECT 1`, no write, 404 for unknown session, and normalized timing output.
- `README.md` -- document that session creation already wakes the DB and describe active-only keep-warm behavior and its five-minute Netlify idle context.
- `netlify.toml` and database settings -- leave unchanged; this remains code-level activity rather than an account setting change.

## Tasks & Acceptance

**Execution:**
- [x] `src/server/reception/routes.ts` and `tests/server/reception-routes.test.ts` -- add a narrow keep-warm endpoint using the existing existence guard and prove it performs no snapshot load or write.
- [x] `src/client/voice/receptionSession.ts` and `tests/client/reception-session.test.ts` -- add a two-minute, single-flight read-only ping while caller activity is recent; stop after four idle minutes and on terminal lifecycle transitions, restart on new caller input, and keep failures from interrupting a session.
- [x] `README.md` -- record the actual startup and keep-warm behavior plus its idle-cost tradeoff.

**Acceptance Criteria:**
- Given a session start, when the controller has its active server snapshot, then existing database startup work is complete before Gemini Live connects and the bounded keep-warm timer is armed.
- Given recent caller activity, when the two-minute interval elapses, then exactly one keep-warm request runs without mutating reception data.
- Given four minutes without caller activity, when the next timer fires, then keep-warm stops; a later caller turn restarts it without blocking transcript/audio delivery.
- Given hang-up, disposal, terminal failure, or reconnect, when the lifecycle changes, then no duplicate timer survives and reconnect only resumes within the active window.
- Given local tests/build and the deployed branch, when verification runs, then all offline checks pass and live health/session/keep-warm smoke checks succeed without booking or editing appointment rows.

## Implementation Notes

Session creation/restoration starts the keep-warm window after its authoritative database snapshot is available and before the Gemini Live connection opens. The client sends `GET /api/reception/sessions/:id/keep-warm` every two minutes while caller activity is under four minutes old; the server's existing session guard supplies the sole `SELECT 1`. Caller turns refresh the activity deadline, microphone chunks do not. Timer cleanup covers stop/disposal, close intent, provider disconnect, and failure; reconnect resumes only within the recent-activity window. New sessions reset the activity timestamp so reusing a controller after a prior closed session cannot suppress the startup timer. Ping failures are swallowed and never gate transcript/audio work.

## Plan Change Log

## Review Triage Log

- verdict: medium; route: patch. Evidence: when a closed controller starts a fresh session after four minutes, the old `lastCallerActivityAt` remains in the past, so both keep-warm arming checks immediately stop; `App.tsx` reuses the controller after ending a session. Reset the activity timestamp for a fresh session.
- verdict: false; route: reject. Evidence: review is intentionally before final verification/deployment, so the local test/build and live-smoke checklist had not yet been recorded when the reviewer read the plan. The review finding asks only for a plan update; record actual results after those checks rather than treating this as a code defect.

## Design Notes

Netlify documents a five-minute idle sleep default for Personal databases and states that Free/Personal plans cannot customize the sleep setting. A one-time `SELECT 1` at session start would not guarantee warmth throughout a longer conversation; this project already persists and snapshots the session before connecting to Gemini. The selected compromise keeps the database active only while caller activity is recent, pings every two minutes (three-minute margin from the documented idle threshold), and stops after four minutes of silence to avoid a background keep-awake loop. A wake ping on renewed input runs concurrently with model interpretation and remains non-blocking. This may still not remove serverless/network cold starts, and live latency must be measured rather than inferred.

## Verification

**Commands:**
- `npm test -- tests/client/reception-session.test.ts tests/server/reception-routes.test.ts` -- expected: lifecycle and route regression tests pass, including timer cleanup and zero domain writes.
- `npm test` -- expected: all offline tests pass.
- `npm run build` -- expected: TypeScript checking and production build pass.
- `git diff --check` -- expected: no whitespace errors.
- After pushing `codex/gemini-health-agent`, inspect the Netlify deploy and test the live health endpoint, create a synthetic session, exercise a read-only keep-warm request after idleness, close it, and verify no appointment was created.

**Manual checks:**
- Measure public API health and keep-warm response duration before/after the idle window; report that this smoke test does not prove end-to-end doctor-lookup latency unless the dialogue is also timed.

**Local results:** Focused route/client tests passed (56/56); full suite passed (55 files, 679 passed, 1 skipped); `npm run build` passed TypeScript checking and Vite production build; `git diff --check` passed. Live checks remain pending until push/deploy.
