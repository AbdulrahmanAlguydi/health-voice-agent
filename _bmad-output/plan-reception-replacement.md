---
title: Resource-centered receptionist replacement
type: feature
ticket: ''
created: '2026-10-03'
status: built
baseline_revision: ceab68c356bcf24146b4a43d58d34ab3b142ae7e
route: full
route_source: pinned
review: thorough
review_source: pinned
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context: [_bmad-output/reception-contracts.md, _bmad-output/architecture-alternatives/architecture-alternatives.md]
---

<frozen-after-approval reason="User approves selected architecture and delegates reviewed implementation unless a substantive unresolved choice needs input">

## Intent

Replace competing client intake/delivery gates with one Gemini Live conversational receptionist and resource-centered server functions. Preserve natural urban Hejazi Arabic/English, database-only facts and persistent synthetic effects. This includes booking plus the approved appointment-management simulations, shipped in verified stages rather than claiming the whole replacement from foundation tests.

## Boundaries & Constraints

Always preserve current source/prompt and consistent demo DB backup before switching. Use separate synthetic SQLite; same fictional 30 doctors/10 specialties, own compatible catalogs. Browser only media/transport; server owns drafts/offers/contact/consent/results. One accepted offer, separately confirmed dictated phone; no mandatory patient ID. Natural speech streams and replay cannot execute a tool. Keep direct Gemini, TypeScript/React/Express/SQLite. Handle unknown facts honestly, administrative routing max two clarifications, emergency nearest hospital, truthful simulated effects.

Never reintroduce prerecorded lines, sentence matching, a second conversational/output-checking model, unrestricted SQL/search, generic workflow engine, real messaging/telephony or destructive database reset. Existing dirty worktree changes remain intact; no broad Git commit.

## I/O & Edge-Case Matrix

| Scenario | Input/state | Expected behavior | Recovery |
| --- | --- | --- | --- |
| Guest book | Accepted actual offer, name, known/dictated phone | One appointment/result/simulated effect | Collect only missing data |
| Correction | Partial phone or changed time/person | Keep unrelated facts; invalidate relevant approval | Targeted issue, never pad digits |
| Lost write response | Commit succeeded, network failed | Same operation result, one row | Reconcile ID, block new mutation |
| Stop/emergency | Delayed uncommitted tool | Serialized fence prevents later commit | Preserve prior committed result |
| Move/cancel | Selected existing target, accepted action | Same appointment ID or released occupancy | Conflict preserves old booking |
| Speech lifecycle | Late captions, interruption/reconnect | No ASR word gate, history preserved | Context restoration, bounded retries |

</frozen-after-approval>

## Code Map

- `src/server/app.ts`, `index.ts`: inject replacement DB/router, preserve legacy fixtures; actual runtime/token use replacement.
- `src/server/db/seed.ts`, alias/directory repositories: reusable fictional bilingual catalog, not legacy patient/slot lifecycle.
- `src/shared/simulatedCallingNumber.ts`, `appointmentLabels.ts`: Saudi normalization and injected-clock labels.
- `src/client/App.tsx`, `voice/audio.ts`: keep mic/history/replay/UI; add streaming callbacks/player queue.
- `src/client/voice/session.ts`, `agent/tools.ts`: legacy behavior remains diagnostic-only; no new adapter imports old gate logic.

## Tasks & Acceptance

Execution follows BMAD build with TDD and disjoint ownership. The companion contracts fix cross-task names and data formats.

- [x] `scripts/backup-prototype.ts`, `.gitignore`: consistent SQLite backup + archive source/prompt/untracked app assets, excluding secrets/dependencies; verify inventory before switching.
- [x] `src/shared/reception.ts`, `receptionContact.ts`, tests/shared: schemas and deterministic phone chunks/corrections. Test literal short/repeated/group digits, versioned confirmation and invalid count before implementation.
- [x] `src/server/reception/{database,service,routes}.ts`, tests/server: new catalog/metadata/schema, domain resources and typed API. Test injected-clock capacity, acceptance, invalid contact, duplicate/lost operation, rollback/restart and close fence first; implement booking vertical slice before management.
- [x] `src/shared/receptionPrompt.ts`, tests/shared: adapted Hejazi persona + declared 13 functions, compact startup context and factual/error descriptions; no fixed ordinary replies or hardcoded date/data.
- [x] `src/client/voice/receptionSession.ts`, `audio.ts`, `App.tsx`, tests/client: thin adapter, stable input/output IDs, flushed media events, sequential tool carrier revisions, streaming queue, immutable bubble/replay attachment and bounded recovery. Test before runtime switch.
- [x] `src/server/{app,index}.ts`, token service: wire replacement runtime/default DB/prompt without mixing legacy adapter/tool permissions; expose simulated activity.
- [x] Domain/API and live fixtures: add lookup/move/cancel/proxy/family/waitlist/callback/summary/transfer under same contracts; test conflicts/24h/partial success and no clinical or real effects.
- [x] Docs/test migration: map previous failures to new observable tests; retain useful old regression fixtures explicitly as legacy rather than pretending their APIs are new. Update current/target status and verification truthfully.

Acceptance:

- Given doctor browsing, when asking a factual question, then no identity intake and only database-backed facts.
- Given one accepted returned opening, when contact/name arrive, then no second appointment yes is required and exactly one valid appointment is saved.
- Given changed/stale/unavailable details, when committing, then no unintended booking occurs and valid unrelated intake survives.
- Given duplicate events, lost responses, restart or closing races, then database/result consistency is asserted independently of spoken claims.
- Given live Arabic/English turns, then inspect transcripts/tool timelines/database and listen separately; offline green tests do not establish accent correctness.

## Implementation Notes

The replacement is implemented. The full fresh offline run passed 589 tests in 52 files and the production build passed. Matrix coverage is exercised by reception-service (guest/correction/lost write/fence/move/cancel), reception-session/audio/App (late captions/interruption/recovery/history) and reception-runtime/routes tests. Real Arabic and English dictated-contact runs each booked, retrieved, cancelled and closed with independent disposable DB checks. Audio/perceptual microphone assessment remains separate.

Review baseline caveat: most application files were already untracked at HEAD. The complete Git-baseline inventory is available in the temp review artifact, while the review diff compares the verified preimplementation backup source to the current tree, including new untracked app files. This isolates this replacement from pre-existing legacy fixtures; no staging/reset is used.

Loose work; isolated existing worktree on codex/gemini-health-agent. Baseline 491 tests/42 files passes. User explicitly delegates checkpoints and routine choices; only substantive unresolved product decisions stop implementation. Detailed schemas in companion are deliberately shared rather than a second planning workflow.

## Plan Change Log

Before-code review resolved technical seams: explicit time/relative/Hijri window arguments; summary action through select/accept/commit; session contact independent of booking; non-versioning audio/text exposure events with common onset ordering; two-phase farewell versus immediate UI Stop; same-event retrieval for lost follow-up results; exact neutral streaming interfaces. No product choice is unresolved. These clarify implementation, not a change to approved intent.

Implementation clarification: the supplied prompt explicitly reuses caller details across household bookings. Keep caller session contact on `newSubject=true` unless the caller changes it, while assigning a separate subject identity and fresh appointment consent. This resolves the companion's ambiguous "inherit only explicitly" sentence; it does not permit phone-based identity merging or summary delivery to an unstored contact.

## Review Triage Log

Final four-lens review (3 October): each finding below was checked against callers/contracts, not accepted from its proposed remedy.

| Finding | Verdict | Evidence / route |
| --- | --- | --- |
| Blind 1: ready operation blocked after lost admission | medium | reconcile leaves unknown when ready; execute blocks even same ID. Patch same-operation retry only. |
| Blind 2: recovered offers lose presentation IDs | medium | catch returns recovered result before pendingOffers assignment. Patch common result handling. |
| Blind 3: rejected end_session schedules close | medium | status != error includes conflict/paused. Patch require ok + closeRequested. |
| Blind 4: fresh session retains old transport state | medium | connect creates new snapshot but retains media/unknown/output. Patch reset when creating a distinct session. |
| Blind 5: independent contact readback proof absent | false | Contract deliberately uses subsequent semantic caller confirmation; it does not claim independent hearing verification. Adding a transcript/readback gate contradicts the approved simplification. |
| Blind 6: exposure may cross connection | false | Output IDs are session-unique and event order stays monotonic across reconnect. A previously presented offer remains legitimate; connection equality would incorrectly reject it. |
| Blind 7: old lookup candidates survive contact changes | medium | select trusts lookupIds despite changed contact. Patch clear on contact change and recheck current contact. |
| Blind 8: new subject retains service/doctor | medium | preferences already cleared, but draft/session service survives. Patch clear subject selection while preserving caller contact. |
| Blind 9: distinct followup events create distinct effects | false | Contract promises identical-event retry dedup, not suppressing independently requested followups. Identical events recover exactly one durable effect. |
| Blind 10: English test begins Arabic | false | Product explicitly starts Arabic and switches after English speech; latest English transcript verifies that switch. No initial-language feature requested. |
| Edge 1: ready reconciliation blocks retry | medium | Same demonstrated cause as Blind 1; patch. |
| Edge 2: stale lookup target | medium | Same demonstrated cause as Blind 7; patch. |
| Edge 3: rejected farewell closes | medium | Same demonstrated cause as Blind 3; patch. |
| Edge 4: midstream mute abandons callbacks | medium | setMuted calls stop with no owner notification, leaving pending farewell/speaking. Patch existing playback failure callback for active stream. |
| Edge 5: telemetry failure prevents emergency | medium | flushMedia precedes emergency request; no exposure needed for admission fence. Patch emergency bypass of telemetry prerequisite. |
| Verification: offline offer-to-server boundary gap | medium | Preverified: controller fixtures never return offers, server manually injects IDs. Patch real-service integration with lost-offer recovery and actual DB commit. |
| Intent 1: accent/microphone not demonstrated | false | No certification claimed; explicitly recorded as separate user listening/microphone assessment. |
| Intent 2: spoken facts depend on model assertion | false | Deliberate semantic convention documented, with deterministic database authority and no claim of independent hearing proof. |
| Intent 3: all management live conversations not demonstrated | low | Domain implemented/tested; live evidence covers booking/lookup/cancel only. Report broader Live coverage pending rather than imply certification. Direct documentation correction. |
| Intent 4: persistence stronger evidence than speech | false | Accurate observation, not a defect; reflected in verification limitations. |
| Intent 5: staged results absent from diff | low | Results reside in plan and reports outside code diff. Add concise runtime verification record, no implementation change. |

All surviving code findings are direct corrections of demonstrated branches with existing interfaces; grouped shared causes patched once. No intent gap, new public surface or new framework is needed. Previous implementer cannot be resumed after session restart; main agent applies patches and full verification. No deferred code issue.

Three independent before-code reviewers identified medium contract gaps above. Adopted their minimal corrections; no new runtime model/framework or mandatory transcript/playback check. Implementation proceeds under user's delegated approval after revised contracts are reconciled.

Revised contracts rechecked by all three reviewers: pass, no unresolved blocker/product input. Include explicit unresolved event recovery, waitlist preferences, same-session event sequence across reconnect, muted playback and close races in tests.

## Verification

Run focused RED/GREEN tests, full `npm test`, `npm run build`; independently review contracts/migration before implementation and code after. Use disposable SQLite and injected clocks. Run repeated new-controller Arabic/English typed Live flows with real generated audio and inspect database counts; actual microphone/perceptual evaluation remains separately reported. Restore site at localhost:5173. Archive rollback path and report any incomplete stage explicitly.

Final review patches each reproduced RED then GREEN. Fresh full verification: 597/597 tests, 52/52 files; production typecheck/build passed (largest JS chunk 425.70 kB). No broad staging/local commit: unrelated design/app files already untracked at baseline, so the skill's generic commit instruction is superseded by the explicit preserve-dirty-tree/no-broad-commit boundary. Four lenses completed; no deferred code issue. Live scope and residual Arabic repetition are recorded in docs/reception-replacement.md, not called a perceptual pass.

Post-review actual Arabic Live known-number smoke passed booking, lookup, cancellation and final closed session: output/reception-live/2026-10-03T02-30-24-645Z-ar-known/report.json. Frontend GET localhost:5173 returned 200 and proxied /api/health returned ok. The site is restored. Broader Live/perceptual trials remain evaluation work, not claimed as completed acceptance evidence.
