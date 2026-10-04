---
title: Booking result recovery after a lost response
type: bugfix
ticket: ''
created: '2026-10-02'
status: complete
baseline_revision: ceab68c356bcf24146b4a43d58d34ab3b142ae7e
route: oneshot
route_source: auto
review: quick
review_source: pinned
lenses_ran: [rubric, reality, seams]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="User delegated architecture investigation and supported fixes without routine permission checkpoints">

## Intent

The existing service deletes a pending request after commit and the client discards its handle before receiving the result. If the HTTP response is lost, the database can contain a booking while the assistant loses the ability to discover it. Preserve a durable result tied to the existing pending ID, and retain the client handle until an outcome is known. Repeating an approval for that same ID returns the stored result without another write, including after server restart. Non-approval cannot revoke a saved appointment or reuse a completed operation to make another one.

Keep this an incremental correction to the running prototype, not an implementation of the expanded server-owned workflow. Preserve existing records and the interactive conversation. No new models, speech gates, generic workflow engine, or database reset. All tests use disposable databases. Keep the dirty worktree intact; do not commit the user's unrelated/untracked work.

</frozen-after-approval>

## Implementation Notes

BMAD agent-led investigation, loose work (no initiative required). One-shot route: additive result table, transactionally stored response, and client unknown-outcome recovery are a small cohesive fix. Supporting setup correction: exclude BMAD runtime/staging/output from Vite watches; the observed Windows rename failure disappeared when the Vite watcher stopped. Review covers both the implemented correction and the architectural follow-up boundaries.

## Verification

- First run regression tests without the fix and observe lost-result/restart failure.
- Run focused real service and client/API sequence tests; assert exactly one appointment and one guest profile, same operation result, retained pending state on network failure, and no success claim while outcome is unknown.
- Run the complete offline suite and production build.
- Start Vite and rerun official BMAD setup to verify the watcher exclusion fixes the actual failure.
- Do not claim microphone, dialect or live-model quality is verified by these tests.

## Plan Change Log

Expanded the same recovery slice after review: preserve draft/early-intake context on unexpected disconnect; reconcile unknown commits before explicit stop; wait for in-flight preparation so a delayed response cannot recreate an abandoned draft. This is not the expanded server-owned workflow migration.

## Review Triage Log

- Fixed lost-result durability/client handle retention; RED regression first, then GREEN.
- Fixed rubric/reality/seam reconnect predicate omissions; regression covers early guest intake and prepared draft.
- Fixed seam delayed-prepare versus stop race; RED regression first, then GREEN.
- Added composed lost commit followed by explicit stop coverage. Broader Live-provider perceptual testing remains outside offline verification.
- Corrected documentation's nonexistent diagnostics route claim and stale preliminary guest-consent/full-playback requirements.
- Final verification: 491 tests across 42 files pass; typecheck/production build pass; architecture lint has zero findings. Dev app returns HTTP 200 at localhost:5173; official BMAD setup reports current while Vite runs (no-change path, not another replacement rename).
- No real API calls or persistent demo booking changes were made by tests. Existing user changes were preserved; no commit created. Empty diagnostic rename-probe folders removed.
