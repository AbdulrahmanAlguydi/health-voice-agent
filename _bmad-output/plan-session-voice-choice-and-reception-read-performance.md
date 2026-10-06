---
title: 'Session Voice Choice and Reception Read Performance'
type: 'feature'
ticket: ''
created: '2026-10-06'
status: 'built'
baseline_revision: 'f93f2f33707b03137fefa5f54515d796f1ecd824'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['AGENTS.md']
---

<frozen-after-approval reason="The user delegated routine design decisions and said to follow recommendations while away from the PC.">

## Intent

**Problem:** Doctor-information requests can trigger a full database snapshot just to check session existence, then read the doctor catalog again while forming the response. The prototype also has no way to compare Google voices from its session-start screen.

**Approach:** Use a light session-existence query for guarded routes and let the snapshot GET build one snapshot only; add privacy-safe request-duration diagnostics. Add a pre-session picker for Google's 30 curated Live-compatible voices, pass the validated choice to Gemini Live, and retain it for reconnects within that session.

## Boundaries & Constraints

**Always:** Database records remain the source of truth; keep the selected voice fixed for a session and its reconnects; preserve current voice default (`GEMINI_VOICE`, falling back to `Kore`); retain existing 404 and request-validation behavior; keep logs free of session IDs, transcript, caller number, names, and database contents; test only with isolated/disposable data.

**Never:** Do not add a second model, voice-preview service, database cache, asynchronous infrastructure, booking-flow changes, production database writes, or deployment/push work. Do not run `db:reset`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid voice choice | Curated voice name selected before session start | Server validates and configures that voice; reconnect uses the same name | No error expected |
| Unknown voice | Malformed or unsupported name sent to token endpoint | No token issued; response is 400 | Existing session and database remain unchanged |
| Missing session | Request uses unknown session ID | 404 without loading doctor/catalog snapshot in the guard | No patient/session details logged |
| Normal request timing | Any reception route completes | Function log records normalized route, method, status, duration only | Logging failure must not fail the request |

</frozen-after-approval>

## Code Map

- `src/client/App.tsx` -- active session-start UI and simulated caller-number control; voice selector belongs here.
- `src/client/voice/receptionSession.ts` -- active Gemini Live controller, token exchange, and reconnect; pin the selected name here.
- `src/shared/receptionPrompt.ts` -- active Live configuration; accepts `voiceName` in `speechConfig`.
- `src/server/routes/gemini.ts` and `src/server/services/geminiTokenService.ts` -- token endpoint, validation, configured default, and provider constraints.
- `src/server/reception/routes.ts` -- guarded session routes and current request path; add cheap existence guard and timing diagnostics.
- `src/server/reception/service.ts` -- `getSnapshot`, `hasSession`, and catalog-backed response facts.
- `tests/client/reception-App.test.tsx`, `tests/client/reception-session.test.ts`, `tests/server/gemini-token.test.ts`, `tests/server/reception-routes.test.ts` -- regression coverage for selector, pinned reconnect voice, validation, 404, query counts, and timing log.
- `README.md` -- replace the fixed-voice description with how session voice choice works.

## Tasks & Acceptance

**Execution:**
- [x] Add a shared curated voice catalog/default and a server-provided safe voice-options response; expose a bilingual-labeled selector before session start and send the choice to token issuance.
- [x] Validate voice names before issuing credentials; retain the chosen voice in `ReceptionSessionController` so reconnects do not change it; update focused client/server tests.
- [x] Add `hasSession()` and move the snapshot GET out of the shared existence guard; keep missing-session responses at 404 and assert the guard does not read doctors/offers/operations/clinic.
- [x] Add structured route-duration logging with normalized paths and no request/session data; test emitted fields and update README.

**Acceptance Criteria:**
- Given a selected supported voice, when a new session starts and reconnects, then both Live configurations use that same voice.
- Given an unsupported voice, when token issuance is requested, then the server returns 400 without creating a Live token.
- Given an existing session snapshot request, when it is served, then exactly one snapshot is built; guarded tool requests use a lightweight existence read rather than a catalog snapshot.
- Given a reception request, when it finishes, then diagnostics contain only method, normalized route, status, and duration.
- Given the full offline suite and production build, when run, then both succeed without modifying persistent production data.

## Implementation Notes

- Shared curated names and English/Arabic descriptions are in `src/shared/geminiVoices.ts`, verified against Google's Live voice documentation. `/api/gemini/voices` returns only that catalog and the configured default. Supported `GEMINI_VOICE` values are preserved; unset/unsupported defaults resolve to Kore.
- The controller pins either the explicit choice or the first token's default for automatic/manual reconnects and rejects credentials for a changed voice. Explicit session closure permits a new choice. The selector stays locked after transport errors; End session remains available there.
- Snapshot GET now bypasses the shared existence guard. Guarded routes use `SELECT 1` only; query-count coverage includes normal doctor-directory tool calls and invalid/missing session requests.
- Reception completion logs contain only `method`, normalized `route`, `status`, and `durationMs`. Unknown paths use a constant fallback and logger exceptions are swallowed.
- Timing diagnostics are mounted before JSON parsing in the app and deduplicated for standalone router use, so even malformed reception JSON gets one completion record.

## Plan Change Log

## Review Triage Log

- quick finding — `medium`, routed `patch` (fixed): `express.json()` previously ran before the reception completion logger, so malformed JSON skipped timing diagnostics. The logger now runs before parsing and is deduplicated; a parser-failure regression test confirms exactly one privacy-safe record.

## Verification

**Commands:**
- `npm test -- tests/client/reception-App.test.tsx tests/client/reception-session.test.ts tests/server/gemini-token.test.ts tests/server/reception-routes.test.ts` -- expected: all focused tests pass.
- `npm test` -- expected: all offline tests pass.
- `npm run build` -- expected: typecheck and Vite production build succeed.

**Results (2026-10-06):**
- Focused command passed all 70 tests across the four listed files. New coverage first failed against the previous implementation for the intended missing behavior.
- Final `npm test` passed 55 files: 671 tests passed, 1 existing test skipped.
- Final `npm run build` passed TypeScript checking and Vite production build.
- Quick review found one diagnostics gap for malformed JSON. It was fixed and covered; the review-adjusted focused suite passed (70 tests), then the full suite and build passed sequentially.
- The first full-suite run, concurrent with a build, timed out on the unrelated Vite-config import. That test passed alone; both subsequent full-suite runs passed without build contention. No timeout/configuration change was made.
- All reception test writes used disposable test schemas. No real provider calls, persistent demo/production writes, resets, deployment, or push operations were performed. Microphone recognition, Arabic delivery, and live latency remain unverified by offline tests.

