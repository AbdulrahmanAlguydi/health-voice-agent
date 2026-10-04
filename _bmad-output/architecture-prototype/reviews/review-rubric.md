# Prototype architecture rubric review

Reviewed 2026-10-02 against the actual dirty worktree, including the architecture spine, booking service/schema, client tool adapter/session, and the three requested test files. This review changes no application code.

Final verdict: pass for the scoped local prototype. The spine is proportionate and matches the implemented recovery boundaries. The medium reconnect defect is resolved; no critical, high or medium rubric findings remain.

## Findings

### Resolved medium — Identity-only and guest-path reconnects sent a fresh welcome

`src/client/voice/session.ts:175-177` decides whether to resume using pending booking ID, completed booking, verified patient ID, or heard slot IDs. The retained tool context also has `pendingIdentityId`, `bookingIntentActive`, and `guestPath`, none of which participates in that predicate. `begin_booking` can perform a patient lookup or choose the guest path before availability has been fetched. An unexpected close at that point preserves the context but reconnect sends the initial Arabic welcome and clears conversational evidence instead of sending the structured recovery state. This falls short of AD-3's explicit requirement to resume the recorded booking stage without restarting intake.

Action: include the retained intake stages in the resume predicate and add a focused reconnect regression without any slot history. This is a small implementation correction, not a new architecture decision.

Resolution verified: the reconnect predicate now includes `pendingIdentityId`, `bookingIntentActive` and `guestPath`. A new early guest-path reconnect regression covers recovery without slot history. The original finding is closed.

### Addressed low — Recovery coverage did not exercise the composed lifecycle

The requested tests cover lost confirmation responses in the tool adapter, a new service instance over the same database connection, and a Live reconnect with an uncommitted draft. They do not cover lost confirmation response followed by Live reconnect or explicit stop while the result remains unknown. The durable service result and stored original approval look coherent on inspection; `cancelPending` explicitly reconciles before clearing state. A focused test of those two composed paths would protect the exact operational boundary AD-2/AD-3 promise. Actual server-restart verification remains pending according to the caller and should be reported as pending until completed.

Action: add the focused lifecycle regressions while implementing the medium fix, and finish the disposable persistent-database restart verification. Do not interpret this as requiring live microphone/provider testing for a database recovery fix.

Resolution verified: the new lost-successful-commit → explicit-stop test asserts that reconciliation clears the unknown handle while exactly one appointment remains. A second regression covers stopping during delayed preparation, and the adapter waits for in-flight operations before clearing/cancelling state. Both pass. Lost-result → Live reconnect is still not directly composed in one regression, but the independently tested resume predicate, retained approval/handle and replay result make this a nonblocking coverage improvement. The caller reports the live server restored; this review does not independently certify a process-restart database probe.

## Good-spine assessment

- The paradigm and boundary diagram match existing browser tool ownership, Express service validation and SQLite effects. The document explicitly marks server-owned conversational workflow as a target, avoiding claims that replacement behavior already exists.
- AD-1 through AD-5 contain concrete, enforceable rules with clear divergence prevention. The booking result insert is inside the same immediate transaction as guest insertion, slot transition and appointment insertion. The opaque pending ID and persisted result support approved replay; rollback assertions cover result-write failure.
- Deferred items properly distinguish browser reconnect from page reload, uncommitted in-memory drafts from committed persisted results, and the local single-process envelope from production infrastructure. Those limits do not undermine the scoped prototype guarantees.
- The operational dimension is present: local Vite/Express execution, sole Gemini provider, database-preserving changes, diagnostics and offline/live evidence boundaries. Additional production deployment design would be disproportionate here.
- No new stack/version choice is being bound by this spine; existing technology names describe observed code. Technology-currentness was not independently reverified by this rubric review.
- No source requirement or inherited invariant was found to be contradicted in the scoped change. This rubric review supports finalizing the spine after the caller completes the remaining gate bookkeeping.

## Verification

Initial independent run: 3 files and 60 tests passed. After the fixes, independently reran `npm test -- tests/server/booking-service.test.ts tests/client/semantic-booking-actions.test.ts tests/client/live-session.test.ts`: 3 files and 63 tests passed, exit code 0. The caller reports the full offline suite at 491 passing and a passing build; those broader results were not rerun here.

Operational caveat supplied by the caller: the current official BMAD refresh was a no-change run, so Vite-watcher replacement-rename behavior was not exercised. This is explicitly documented and does not expand the prototype architecture guarantee.
