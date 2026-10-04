---
title: 'Expose accurate appointment windows and strengthen booking regressions'
type: 'feature'
ticket: ''
created: '2026-10-04'
status: 'built'
baseline_revision: 'ceab68c356bcf24146b4a43d58d34ab3b142ae7e'
route: 'oneshot'
route_source: 'pinned'
review: 'quick'
review_source: 'pinned'
lenses_ran: [quick]
review_loop_iteration: 1
context: ['{project-root}/AGENTS.md', '{project-root}/_bmad-output/reception-contracts.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The agent presents one early 15-minute start rather than making the doctor's actual contiguous availability understandable. Existing regressions do not sufficiently prove that past slots and confusing caller decisions cannot create or report a booking.

**Approach:** Derive contiguous available appointment-start windows from persisted capacity and occupancy, surface them to Gemini, and guide it to check a caller-selected exact time before obtaining agreement to that exact offer. Add disposable-database tests for window gaps, past openings, ambiguous/corrective responses, and booking persistence. Keep the existing 30-day synthetic schedule and three-offer cap; its lazy generator already stores ample capacity. Also carry forward the requested modest reduction in prompt formality without changing the Hijazi voice target.

</frozen-after-approval>

## Implementation Notes

- Replaced broad single-start discovery with up to three localized, discovery-only appointment-start ranges grouped from persisted capacity and occupancy. Ranges honor 15-minute granularity, service duration, working hours, the configured horizon, and lead time; an occupied booking splits the returned windows. A selected time is checked again with `exactTime` and yields a precise offer; windows never yield offer IDs or authorize consent.
- Added regressions for range endpoints and occupied gaps, exact-time follow-up without accidental booking, persisted past capacity exclusion, plentiful lazy schedule generation (992 capacity rows per doctor in the configured 31-day horizon), unclear/qualified/declined replies, a changed doctor/time invalidating a ready operation, and ensuring broad-window speech cannot inherit older exact-offer presentation IDs.
- Updated Gemini tool/system guidance and localized labels so Arabic/English window endpoints are clear. Slightly relaxed the Arabic conversational-style wording while retaining booking guardrails and the Hijazi target.
- The persistent demo database was not bulk-modified: capacity is generated on demand for the searched doctor, and all new booking/past-slot verification uses disposable databases.
- Quick review caught that an exact clock time without a single-day scope could return offers for the same time on different dates. The server now asks for a specific date before issuing any exact-time offer; tests cover omitted dates, explicit multi-day bounds, relative multi-day windows, and the successful one-day follow-up.

## Verification

**Commands:**
- `npx vitest run tests/server/reception-service.test.ts tests/client/reception-session.test.ts tests/shared/appointmentLabels.test.ts tests/shared/receptionPrompt.test.ts` -- focused tests pass.
- `npm run typecheck` -- expected: TypeScript succeeds.
- `npm test` -- expected: full offline suite passes.
- `npm run build` -- expected: production build succeeds.

**Results:** Final fresh verification after the review fix: `npm test` passes 643 tests across 53 files; typecheck passes; production build succeeds.
