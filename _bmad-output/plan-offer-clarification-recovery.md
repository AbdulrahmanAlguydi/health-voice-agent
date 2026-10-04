---
title: Recover booking consent after an unclear or mistimed offer response
type: bugfix
ticket: ''
created: '2026-10-04'
status: built
baseline_revision: ceab68c356bcf24146b4a43d58d34ab3b142ae7e
route: oneshot
route_source: auto
review: quick
review_source: pinned
lenses_ran: [quick]
review_loop_iteration: 0
context: [_bmad-output/reception-contracts.md, _bmad-output/architecture-alternatives/architecture-alternatives.md]
---

<frozen-after-approval reason="User asked to improve the diagnosed coverage and booking failures; the prior conversation approved preserving consent guards and adding a transcript-derived regression.">

## Intent

**Problem:** The live Arabic booking run refreshed a stale slot correctly, but the model then pursued name collection after an ambiguous reply and retried acceptance from a response that did not present the offer. The server correctly refused those attempts; Gemini still announced success, and tests missed the interaction because they scripted clean tool sequences and reused a single output ID.

**Approach:** Keep stale-offer and exact offer/output/turn checks. When an active offer acceptance is refused for clarification, associate that offer with the next assistant reply so a natural re-presentation is verifiably exposed before a later caller decision. Strengthen concise prompt guidance for mixed/unclear assent, add unique-output transcript-derived adapter/domain regressions, and verify no appointment is written until `committed`.

**Always:** Keep one Gemini Live session, free-form Arabic/English speech, server-owned booking state, and the existing exact-output exposure and subsequent-known-caller-turn requirements. A booking succeeds only on `commit_request: committed`.

**Never:** Do not weaken stale/current-turn/offer-output checks; add a second model, fixed spoken lines, broad output gate, production services, schema changes, or changes to persistent demo data.

</frozen-after-approval>

## Implementation Notes

One-shot scope is limited to the active offer-recovery handoff, the booking prompt, and the tests that must reproduce the observed sequence with distinct output IDs. The existing local checkout is intentionally dirty; preserve all unrelated work and do not commit the broad untracked project tree.

Implemented without changing database schema or demo records. A still-active offer is now attached to the next assistant output only after `accept_offer` returns `needs_clarification`; prompt guidance asks for a natural restatement of the same booking's doctor, exact date and time, then a new caller turn. Server consent/output checks are unchanged. Corrected the transcript regression to use Dr. Nada's actual synthetic ID (`doc-028`) and verify the committed row's exact UTC instant. Server fixtures now use distinct output IDs, with a regression for unrelated intervening output. Added the behavior and test-gap rationale to the reception contract and decision log.

Verification: focused regression suite 88/88 passed; full suite 630/630 passed; `npm run build` passed typecheck and Vite production build. An additional focused rerun after aligning Dr. Nada's ID and exact offer time passed 41/41. No live Gemini/audio test was run, so natural-language compliance and audible quality remain unverified.

## Review Triage Log

Quick independent review confirmed that no server consent or commit guard was removed. It found the first replay assertion checked offer association but did not correlate the exact transcript to its output ID. Strengthened the regression to assert Dr. Nada/date/time in the emitted transcription and that the same output ID carries the active offer. The review also noted that offer association is not proof of spoken semantic content; this remains an acknowledged Gemini assertion under the approved free-form, no-output-gate design. No other findings.

Final verification after review: `npm test` passes 630 tests across 53 files; `npm run build` passes typecheck and production Vite build. No live Gemini request, microphone test, or persistent demo-data write was made.
