# Workflow replacement — design review and calling-number implementation

> **For agentic workers:** use test-driven-development for each implementation slice. This review is not the full replacement implementation task plan.

**Goal:** Add simulated caller metadata and review the replacement against the supplied working prompt and previous failures.

**Architecture:** Preserve Gemini Live and SQLite. Replace competing booking state owners with one server action context; keep conversation wording model-generated and domain writes deterministic. The field is a small compatible addition to the existing app, not proof that this replacement already exists.

**Tech stack:** React, TypeScript, Express, SQLite, Gemini Live, Vitest.

## Review result

The direction fits the supplied prompt after adaptation, with the following corrections incorporated in the design:

| Finding | Decision |
| --- | --- |
| Presumed caller ID does not exist in a browser | Explicit optional synthetic number field; normalized metadata; unknown when blank. No identity or consent implied. |
| Caller number and appointment contact can differ | Keep the initial calling number separate from editable contact; reuse metadata unless corrected. |
| Readback/delivery flags could recreate old loops | No transcript matching or output withholding. Offer revision identifies what is being accepted; media events provide context only. |
| Choosing a time versus confirming a saved booking | One accepted offered slot; intake afterward; short success acknowledgement after actual commit. No second booking confirmation. |
| “Earliest” could ignore the requested date | Earliest within the requested window; at most two alternatives per turn; no silent substitutions. |
| Recovery offered callbacks after phone capture failed | Save callbacks only with valid contact. Otherwise offer a different capture approach or simulated reception handoff. |
| Cancellation/summary actions could reuse unrelated yes | Require action-specific acceptance and an unambiguous target/revision. |
| Emergency directions differed from agreed scope | Brief nearest-hospital emergency-department direction, with contextual triggering and no fictional destination. |
| Ending can hide unresolved work | Record intent/outcome; reconcile unknown writes and preserve partial success. |

## Previous failure mechanisms and replacement requirements

- Browser draft flags plus server pending state: remove competing authorities, do not add a third controller. The browser transports requests and renders snapshots.
- Delayed or incorrect transcript blocking consent: Gemini reports semantic intent against an explicit offer. Domain code validates target/revision/capacity, not the caller's exact words. This reduces application-induced stalls but cannot eliminate model misunderstanding.
- Lost response after a database write: persist operation results and query/reuse the same operation ID. A reconnect must not create another booking.
- Invalid short phone: return actual accumulated digits, missing count and a repair path. Preserve the selected slot/name; no success claim on validation failure.
- No voice after ordinary replies: remove old full-response speech gates in the replacement. Test streamed audio, interruptions and playback failures separately from booking validity.
- Voice inconsistency: one voice configuration and concise Arabic persona, without prerecorded substitutes. Listening tests remain necessary; text tests cannot prove natural pronunciation.

## Calling-number slice (implemented separately)

- [x] Add failing normalization, UI and real-controller boundary tests.
- [x] Observe failure because the helper, field and context are absent.
- [x] Implement `src/shared/simulatedCallingNumber.ts`: optional Saudi local/+966 input, Arabic/Persian digit normalization, no guessing or padding.
- [x] Add labeled field in `src/client/App.tsx` and styles; reject invalid input before connection; lock during active/connecting sessions.
- [x] Extend `SessionControllerApi.connect` with optional metadata; validate at controller boundary.
- [x] Add structured synthetic context to `createGeminiLiveConfig`; no patient speech fabrication, identity claim or consent bypass.
- [x] Verify focused tests, including clearing metadata on subsequent anonymous sessions.

The current app still uses the old booking functions and patient-ID path. This field does not migrate them. Current reuse of the field is conveyed to Gemini through session instructions; the replacement must additionally initialize authoritative server contact state from it.

## Remaining work before the replacement's detailed task plan is executable

1. Specify exact function request/result contracts, revision ownership and operation-ID lifecycle. Include unknown-outcome reconciliation and action-specific consent. Do not retain old tools alongside the new ones without an explicit migration boundary.
2. Define a small fictional service catalog with duration, minimum lead time, published booking horizon and basic eligibility/follow-up rules. Configuration must be database-owned; no medical eligibility inferred from general model knowledge.
3. Define phone accumulation/correction and contact-source transitions. The initial web field supports Saudi formats only; do not advertise arbitrary international support until validators and tests exist.
4. Write replacement tasks in stages: backup/new database → one guest booking vertical slice → lookup/reschedule/cancel → remaining simulated management features. Each stage gets domain tests and Arabic/English live trials before expansion.
5. Map each old regression test to a retained invariant, rewritten scenario or documented obsolete requirement. Use isolated databases, injected clocks and explicit operation counts; never use the interactive demo database for destructive test fixtures.
6. Include measured tool/backend/audio latency, lost-response-after-commit cases, transcript reordering and actual microphone checks. Do not claim model-error elimination from deterministic passing tests.

No new framework, second model or real external service is needed. Backup and database migration remain prerequisites for the larger rewrite, not completed actions.

## Verification of the number-field slice

On 2026-10-02, all 484 tests across 42 files passed, and `npm run build` passed including TypeScript checking. The focused red/green run covered number normalization, invalid-number rejection before network access, field locking, blank input and metadata reset across sessions. No live Gemini or microphone test was run for this slice; natural reuse of the number remains a live-model behavior to verify, not a guarantee inferred from unit tests.
