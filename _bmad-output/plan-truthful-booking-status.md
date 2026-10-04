---
title: 'Keep booking-status replies truthful while details are incomplete'
type: 'bugfix'
ticket: ''
created: '2026-10-04'
status: 'built'
baseline_revision: 'ceab68c356bcf24146b4a43d58d34ab3b142ae7e'
route: 'full'
route_source: 'pinned'
review: 'quick'
review_source: 'pinned'
lenses_ran: [quick]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The English Live run had an invalid three-digit contact. After the caller accepted an offered time, `accept_offer` correctly returned `invalid_contact`, no operation ID, and no database write; its response already said `appointmentSaved:false` and `slotReserved:false`. Gemini nevertheless said it had “reserved” the time. The global prompt already prohibits this, but the result does not clearly summarize the booking lifecycle at this transition.

**Approach:** Make the server result positively distinguish an accepted offer from a created booking, and give `accept_offer` focused, result-specific guidance for missing/invalid details. Add server, adapter, and Live regressions so we verify the returned facts, actual database effects, and caller-facing wording separately.

## Boundaries & Constraints

**Always:** Only `commit_request` with `committed` proves a booking. Preserve a caller’s accepted offer while collecting or repairing contact/name. Keep conversational wording flexible; inspect the recorded Live transcript/audio for this case and verify database state independently.

**Never:** Add a second model, prerecorded line, exact-sentence matcher, broad output gate, schema migration, or changes to the persistent demo data. Structured status can reduce confusion but cannot guarantee unconstrained Gemini Live speech; do not claim otherwise.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Accepted offer, incomplete contact | Caller accepts an exposed offer with missing/invalid phone | Result says the offer was accepted, booking is not created, capacity is not held, and more contact details are needed; no operation ID or appointment row | Keep the selected offer and identify the missing/correctable detail |
| Contact repaired and confirmed | Caller supplies a valid number after the accepted offer | Result may become `ready`, clearly still unsaved; only `committed` after `commit_request` reports success | Reconcile unknown commit outcomes with the same operation ID |
| Live wording regression | Replay the incomplete-contact transition through Gemini Live | Save transcript/audio and tool results; inspect whether speech falsely says reserved/booked, without exact-line assertions | Report Live/provider unavailability separately from offline test results |

## Code Map

- `src/server/reception/service.ts` -- assembles authoritative lifecycle facts and currently returns pending outcomes.
- `src/shared/receptionPrompt.ts` -- Gemini function descriptions and booking guidance; add the missing result-specific distinction without fixed spoken wording.
- `src/client/voice/receptionSession.ts` -- forwards function results to Live; confirm the new facts survive serialization unchanged.
- `tests/server/reception-service.test.ts` -- domain status and SQLite-effect regressions.
- `tests/client/reception-session.test.ts` -- Live-adapter tool-result serialization and no-write-before-commit regression.
- `scripts/smoke-reception.ts` -- opt-in Live run/report for the incomplete-contact transition; actual speech remains separately inspected.
- `_bmad-output/reception-contracts.md` -- document the additive result facts and their meaning.

## Tasks & Acceptance

**Execution:**
- [ ] `src/server/reception/service.ts`, `src/shared/receptionPrompt.ts`, `_bmad-output/reception-contracts.md` -- expose an explicit accepted-but-not-booked lifecycle and explain how to handle `invalid_contact`/`needs_details`; retain existing false effect flags and free-form speech.
- [ ] `tests/server/reception-service.test.ts`, `tests/client/reception-session.test.ts` -- prove incomplete contact yields no operation/appointment, facts survive to Gemini, contact repair preserves acceptance, and exactly one row is written only after a committed result.
- [ ] `scripts/smoke-reception.ts` -- cover this transition in the opt-in Live flow, recording speech and checking actual database state without brittle wording assertions.

**Acceptance Criteria:**
- Given an accepted offer and incomplete contact, the serialized Live tool result unambiguously reports “accepted selection, not booked, no slot held”; database appointment/effect counts remain zero.
- Given repaired and confirmed contact, the same offer proceeds; only a committed response corresponds to one persisted appointment.
- Offline tests pass. If Live credentials are unavailable, report speech behavior as unverified rather than treating contract tests as proof.

## Design Notes

The confusing turn contains two independent facts: the caller accepted a specific offered time, while the booking operation cannot be prepared until contact is valid. Preserve the existing `status`/`missingFields` meanings where practical and add a compact lifecycle fact rather than inventing a new workflow stage or database record. For example, the result can say the offer was accepted, the booking is `not_booked`, and the next step is contact repair; `ready` remains unsaved and `committed` remains the only success. The adapter already forwards generic facts, so test that boundary rather than adding a second state owner. This structured distinction and tool guidance are a reliability improvement, not a guarantee over Gemini’s free-form speech; the Live replay records evidence for review without deciding behavior by exact wording.

## Implementation Notes

## Plan Change Log

## Review Triage Log

</frozen-after-approval>

## Verification

**Commands:**
- `npm test -- tests/server/reception-service.test.ts tests/client/reception-session.test.ts` -- expected: targeted state, serialization and persistence regressions pass.
- `npm run typecheck` -- expected: no TypeScript errors.
- `npm run build` -- expected: production build completes.
- `npm run reception:audio:smoke -- --english --rounds=1 --dictated` -- expected: replay the English regression through Live and save the transcript, audio, tool results, and disposable-database checkpoints. This run completed with zero smoke failures; evidence is in `output/reception-live/2026-10-03T22-06-31-092Z-en-dictated-audio/report.json` with nine WAV outputs alongside it.

**Manual checks:**
- Inspect the Live report’s tool result, transcript and audio together. The observed `accept_offer` reply asked for the phone number (“To secure this appointment…”) without claiming it was already reserved/booked; appointment/effect/occupancy counts remained zero through `ready` and changed only after `committed`. Do not infer speech correctness from offline tests or use exact phrase assertions.
