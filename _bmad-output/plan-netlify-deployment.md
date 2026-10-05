---
title: 'Prepare Rafiq for persistent Netlify deployment'
type: 'feature'
ticket: ''
created: '2026-10-05'
status: 'done'
baseline_revision: '66aa96c67c3788e329354c692b11dc9631d2518e'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['_bmad-output/reception-contracts.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Netlify can build the current Vite UI, but the branch has no deployed API function and its active receptionist stores bookings in a local SQLite file. A static deploy would appear online while API calls fail, and function-local SQLite would not provide durable, shared bookings.

**Approach:** Keep Vite and Express, expose the existing API through a Netlify Function, and move only the active receptionist state to Netlify Database/Postgres. Preserve the legacy SQLite fixtures and demo workflow; run the active feature locally through Netlify's Vite emulation and database so the same API and SQL paths are exercised before deployment.

## Boundaries & Constraints

**Always:** Persist sessions, offers, operations, appointments, slot occupancy, events, media, history, and effects in Postgres. Keep a single active receptionist service implementation. Preserve atomic booking/reschedule, duplicate-event and operation recovery, session version checks, and the fictional bilingual clinic catalog. Keep Gemini Live in the browser; only mint its short-lived token and handle receptionist functions server-side. Keep `GEMINI_API_KEY` server-side.

**Never:** Use function-local SQLite or in-memory state for production bookings; replace the Gemini Live model; move API credentials into Vite/client variables; migrate unrelated legacy database endpoints; add real patient data or real calling.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| API request | `/api/reception/...` through Netlify | Express route receives the original path and returns its existing JSON contract | Route-specific status and error body remain intact |
| Durable session | Create session, cold-start another function invocation, fetch session | Session snapshot and active appointments remain available | Database connection/query failure returns a controlled API error, not false success |
| Competing bookings | Two accepted requests claim overlapping capacity | At most one commits; occupancy and appointment/effect/history are atomic | Loser receives conflict/retry state; no partial rows |
| Retry after lost response | Repeat event or operation identifier | Return the stored outcome without duplicate appointment/effect | Changed payload for same event remains a conflict |
| Missing Gemini key | Request token without server configuration | No token is issued and the API reports a configuration failure | Never expose key or stack details |

</frozen-after-approval>

## Code Map

- `src/server/reception/service.ts` -- owns booking/session semantics using async Postgres transactions and one pinned client through each transaction.
- `src/server/reception/database.ts` -- returns Netlify's runtime Postgres pool; the legacy `src/server/db/` remains separate.
- `src/server/reception/routes.ts`, `src/server/app.ts`, `src/server/routes/gemini.ts` -- make persisted service/snapshot calls awaitable without changing public JSON contracts.
- `src/server/index.ts` -- retain the local Express entry for legacy/test compatibility only if needed; use shared app construction for Netlify rather than listening inside a function.
- `netlify/functions/api.ts`, `netlify.toml`, `vite.config.ts` -- wrap Express, route `/api/*`, configure build/function paths, and provide local Vite emulation.
- `netlify/database/migrations/` -- version Postgres schema and seed only the existing synthetic clinic, services, doctors, and specialties.
- `tests/server/reception-service.test.ts`, `tests/server/reception-routes.test.ts`, `tests/server/reception-runtime.test.ts`, `tests/client/reception-session.test.ts`, `tests/server/netlify-function.test.ts`, and `tests/helpers/receptionDatabase.ts` -- exercise async Postgres semantics, rollback/recovery/concurrency and the deployed function JSON boundary. Legacy DB tests stay unchanged.
- `netlify/database/migrations/`, `netlify/functions/api.ts`, `netlify.toml`, `vite.config.ts` -- define schema/catalog, shared Express function, route rewrite, build paths and local Netlify emulation.
- `README.md`, `docs/hosting-options.md`, `docs/health-voice-agent-design.md`, `docs/reception-replacement.md`, `docs/implementation-architecture.html` and exported diagram images -- align project/setup/architecture guidance and visuals with the active deployment. `.env.example`, `package.json`, and `package-lock.json` define supported configuration and scripts.

## Tasks & Acceptance

**Execution:**
- [x] Add Netlify Function + Vite dev integration, route rewrites and runtime env documentation; keep `/api/*` behavior consistent locally and in production.
- [x] Add Postgres schema/migrations and existing synthetic catalog seed; do not copy appointments or patient data from old SQLite files.
- [x] Refactor active ReceptionService and callers to async Postgres transactions with session row locking and unique capacity constraints; preserve operation/event recovery order and atomic effects.
- [x] Port and extend active service, route, runtime and client tests; include transaction rollback/retry, restart durability, duplicate operations and simultaneous slot claims.
- [x] Update Netlify hosting docs and scripts; run test suite, typecheck/build, local Netlify function/database smoke checks, then provide exact dashboard values and required environment variables.

**Acceptance Criteria:**
- Given a clean checkout with dependencies installed, when `npm run build` runs, then typecheck and Vite production build succeed and Netlify discovers the API function.
- Given the local Netlify-emulated environment, when the current bilingual demo flow creates and commits a booking, then a fresh service instance retrieves the same confirmed booking from Postgres.
- Given concurrent confirmations for the same final capacity, when both requests commit, then only one appointment owns the capacity and neither transaction leaves partial booking records.
- Given a production function request with `GEMINI_API_KEY` configured, when a session is created and token issued, then the token endpoint works without exposing the key to the browser.
- Given these changes are complete, when the user enters Netlify build settings, then the deploy uses the configured branch, root base, `npm run build`, `dist`, and `netlify/functions` and the booking API is not a static-only deploy.

## Implementation Notes

Baseline: existing `npm test` passes 648 tests across 54 files; `npm run build` succeeds. Agent read-only review confirmed that `better-sqlite3`'s global writer serialization must be replaced deliberately: serialize commands with `SELECT ... FOR UPDATE`, retain uniqueness constraints, and explicitly handle a competing occupancy insert. Netlify Database local mode supplies a real Postgres-compatible dev database, so prefer it over a second SQLite/Postgres runtime adapter.

## Plan Change Log

- 2026-10-05: Completed Netlify Functions/Postgres implementation, function-boundary and persistence coverage, and local Vite/Netlify database smoke checks. Updated setup/design/architecture docs and exports to the active architecture; removed the obsolete verifier setting from `.env.example` and corrected the reception contract's persistence description.
- 2026-10-05: Quick review found the cross-session activity diagnostic exposed caller-entered contact details through the public function. Kept it opt-in for the standalone local development server, disabled it in the Netlify Function, and added a function-level 404 regression.

## Review Triage Log

- Resolved: unauthenticated `/api/reception/activity` returned cross-session names and phone numbers. It is now registered only when the standalone local server explicitly enables development diagnostics; the Netlify Function does not expose it. Focused route/function tests pass.

## Design Notes

Netlify's database driver can use different connection behavior in Functions and local/long-running contexts; use its provided pool and reserve one client per transaction (`BEGIN` through `COMMIT`/`ROLLBACK`). Database migrations own schema/catalog setup; function cold starts must not create schema or copy from a local SQLite file. Netlify local Postgres and Vite plugin should make production API/storage paths testable without linking local tests to production data.

## Verification

**Commands:**
- `npm test` with `TEST_POSTGRES_URL` set to the disposable PostgreSQL test database — 55 files and 654 tests passed, including real transaction/concurrency and persistence cases.
- `npm run build` — typecheck and Vite production build passed without chunk-size warnings.
- `npx netlify functions:build --src netlify/functions --functions .netlify/functions` — Netlify API function bundle passed.
- Local Netlify Vite emulation on an isolated port — migration command reported no pending migrations; `/api/health`, session creation/restoration and session close passed; database query confirmed 30 doctors and 10 specialties.

**Manual checks:**

- Production deploy and actual microphone/voice test require the user to connect a Netlify site, enable Netlify Database, and configure the server-side `GEMINI_API_KEY`; this checkout is not linked to a Netlify site and those external steps are not part of the push.
- After connecting the site, use the exact build settings in `docs/hosting-options.md`, verify the initial production migration, and complete a voice booking test before sharing the public URL.
- In Netlify settings, only `GEMINI_API_KEY` is required for voice; database access is supplied by Netlify Database. Confirm the production DB is created for the site before its first production deployment.
