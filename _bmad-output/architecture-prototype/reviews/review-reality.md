# Architecture reality review

Reviewed and rechecked 2026-10-02 against the active working tree, not only its base commit. Verdict: **pass**. Both original findings are resolved. The current ownership, transaction, durable-result, booking-context reconnect and normal Gemini path descriptions match source; AGENTS.md consistently distinguishes current client gates from the planned server-owned replacement.

## Findings

1. **Resolved — reconnect coverage.** The resume predicate in `src/client/voice/session.ts:175-178` now includes `bookingIntentActive`, `guestPath` and `pendingIdentityId` as well as drafts, completed bookings, verified patients and delivered availability. Earlier intake state therefore qualifies for structured recovery. Updated guest/draft reconnect regressions verify absence of a fresh greeting and cancellation; the pending identity inclusion was also verified in source.

2. **Resolved — diagnostics ownership.** The capability map now says “client diagnostic logging, tests, scripts,” consistent with `src/client/logging/sessionDiagnostic.ts`, the session callback and browser prototype logs in `src/client/App.tsx`.

AGENTS.md and the spine agree on local prototype scope, direct Gemini speech, transactional booking results, reconnect versus explicit cancellation, additive schema changes, and deferred reload recovery/server conversational ownership. The watcher statement records a historical conflict and current exclusion policy. `docs/decision-log.md` explicitly says the restored-server setup run was a no-change check and did not exercise another replacement rename; no new rename verification is claimed.

## Confirmed claims

- Current layered ownership is accurate: `src/client/agent/tools.ts` holds legacy intake, identity, availability, summary and approval gates; `src/client/voice/session.ts` owns transport/media coordination. Routes/contracts and `BookingService` validate effects. A server-owned conversational session remains deferred, not silently implemented.
- AD-2 is implemented. `BookingService.confirm()` checks the saved `booking_results` row before its in-memory pending map (`src/server/services/bookingService.ts:159-176`). Its immediate transaction includes optional guest creation, conditional slot claim, appointment insertion and result insertion (`:179-253`). `src/server/db/schema.sql:71-75` adds a keyed result table; `connection.ts` applies the schema and additive mobile column without resetting data. Drafts remain in a service-local map and can disappear on restart.
- Unknown commit outcomes retain the pending ID and original approval transcript. Client mutations are blocked until the same `confirm_booking` is reconciled (`src/client/agent/tools.ts:267-270,671-714`). Explicit stop calls `cancelPending`, which first retries an unknown operation and preserves it if recovery is still unknown (`:792-819`). Transport cleanup does not call cancellation (`src/client/voice/session.ts:805-844`). This supports pending-booking recovery within the existing browser controller, not page reload recovery.
- Normal app speech uses Gemini Live without a second model or prerecorded speech layer. The controller uses `@google/genai` Live and defaults to delivery-only checks (`session.ts:70-79,161-166`); `App.tsx` does not inject a verifier. `src/server/index.ts` wires only token issuance, not the retained optional `outputVerificationService.ts`. The presence of that optional service does not contradict the document's normal-path qualification.
- Package reality supports React/Vite, Express, SQLite through `better-sqlite3`, Zod and `@google/genai`. The architecture makes no pinned dependency or external API-version guarantees requiring a version audit.
- The document correctly limits offline evidence: test success does not certify actual microphone transcription, accent, voice or live latency.

## Verification evidence

Executed in the active worktree:

- `npm test -- tests/server/booking-service.test.ts tests/client/intake-recovery.test.ts tests/client/prototype-simplification.test.ts`: 3 files, 33 tests passed.
- `npm test -- tests/client/live-session.test.ts tests/client/semantic-booking-actions.test.ts`: 2 files, 44 tests passed.
- Recheck after the fixes: `npm test -- tests/client/live-session.test.ts tests/client/semantic-booking-actions.test.ts`: 2 files, 47 tests passed.

The coordinating agent additionally reports the full 491-test suite and build passing; those broader commands were not independently repeated by this reviewer.

These include durable-result replay after constructing a new service, transactional rollback when result insertion fails, unknown-response retry, and pending-draft transport reconnect. Service restart is simulated by a new service instance over the same database; a separate OS-process restart and live-provider session were not exercised in this review.
