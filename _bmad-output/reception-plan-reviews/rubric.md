# Before-code reception plan rubric

Reviewed 2026-10-03 against the approved alternatives spine and replacement product design. Inputs: `plan-reception-replacement.md` and `reception-contracts.md`. No runtime edits or tests: this is a planning review.

Final verdict: pass for before-code implementation. The ownership, separate database, streaming media, resource revisions and transactional recovery are aligned. All four medium contract findings below are resolved by the revised companion contracts; no blocker remains and no additional infrastructure is needed.

Rechecked the revised plan and full companion contracts. The plan records the adopted corrections without claiming implementation. Session-level contact independent of drafts, non-versioning exposure telemetry, common input/output ordering and neutral streaming interfaces further clarify ownership without adding legacy speech gates. The following original findings remain for audit history.

## Resolved P2 — Availability could not express all supported requested windows

`find_available_slots` has only `date`, `fromDate` and `toDate`. There is no exact local time or time-of-day range to constrain “tomorrow afternoon,” “after Asr,” or a caller-proposed time. The contract promises earliest within the requested window, but its typed boundary can only convey date bounds. It also accepts Gregorian dates directly without specifying how code resolves relative/Hijri input, leaving a divergence with the spine's code-derived time convention.

Add a bounded typed window representation and deterministic clock-based resolution entry point/helper. Persist the actual requested window for later search/waitlist rather than silently losing it. Tests should distinguish earliest overall from earliest within the requested date/time window, exact proposed time, ambiguous resolution and midnight/Hijri transitions.

Resolution: arguments now include local `fromTime`, `toTime`, `exactTime`, `dateExpression` and `calendar`; server code resolves supported relative/Hijri dates using the injected clock and clarifies unsupported/ambiguous phrases. Local interval boundaries are specified. Preserving submitted preference payloads for waitlist belongs in the follow-up implementation tests.

## Resolved P2 — Simulated summary links had no action-specific acceptance path

The product source explicitly requires selected target and action-specific acceptance before sending a summary link. `select_appointment` supports only `reschedule|cancel`, and `ReceptionOffer.action` likewise excludes summary delivery. `record_followup(kind=summary_link)` can persist an effect directly from `appointmentId` without a declared summary-specific consent record. A prior cancellation yes or generic yes could be reused incompatibly by separately built server/client code.

Define a small summary-target acceptance contract (or extend the existing immutable action offer) bound to the selected appointment/version and registered contact. Require its acceptance before persisting the simulated link; test wrong target, unrelated-action yes, stale target and duplicate/lost-result delivery. Keep clinical contents absent.

Resolution: `summary_link` is now an appointment draft/offer action; `select_appointment` binds the target and stored contact, and `accept_offer` plus `commit_request` handles the effect. Direct follow-up kinds no longer include summary links.

## Resolved P2 — Domain end timing conflicted with interrupted farewell

`end_session` establishes the domain admission fence immediately, but the same row says new caller speech can cancel pending media close **before domain end**. If the function request is sent when Gemini emits it and farewell audio is still queued/playing, the server has already closed the session; cancelling playback cannot restore the active domain context. The source requires helping a caller who speaks before hangup.

Specify that model-requested normal ending is deferred by the adapter until farewell delivery completes and no later input has cancelled it, while explicit UI Stop and emergency admission fences remain immediate. Bind deferred close to output/input generation IDs and test tool-before-audio, new speech during farewell, stale completion callbacks, direct Stop and ending with unknown prior result. This is media lifecycle bookkeeping, not a conversational stage controller.

Resolution: model `end_session` requests only media close; `/close` performs the actual fence after playback drains. New input cancels pending close, failed/disconnected farewell abandons it, explicit UI Stop closes immediately, and unexpected disconnect retains the active session. Output IDs and queue-generation cancellation provide the adapter implementation boundary.

## Resolved P2 — Follow-up writes bypassed the declared operation recovery mechanism

`record_followup` persists waitlist/callback/transfer/summary effects directly, but recovery says commits reconcile via `get_operation` and all unknown writes block new mutation. Unlike `commit_request`, the follow-up call has no previously issued operation ID. A lost response leaves the client with an event ID but no documented result lookup. Event deduplication helps an identical retry, but it does not define reconciliation after that retry also times out or across reconnect.

State the recovery path explicitly: either issue a server operation ID before the effect, or expose a durable same-session event-result lookup and use that for these bounded single-call writes. The effect and recoverable result must be in one transaction; unknown outcomes cannot be reported as unsaved. Test a lost successful callback/summary result across retry and reconnect, asserting exactly one activity record.

Resolution: `GET /sessions/:id/events/:eventId` retrieves durable deduplicated command results, including follow-ups whose response was lost. The contract distinguishes never-admitted from unresolved events; same-event retries/retrieval recover exactly one effect. Implement the explicit unresolved result in the final strict status schema rather than falling back to generic error. This is routine schema completion, not an unresolved architecture choice.

## Positive assessment and implementation boundaries

- The staged tasks identify concrete files, TDD layers, backup-before-switch, the first booking slice, management expansion and failure/test migration. The runtime/token switch explicitly selects one new authority; old fixtures remain explicit legacy coverage.
- The plan avoids sentence matching, whole-turn withholding, another model, copied clinic records and production infrastructure. Media exposure is telemetry and semantic context, not proof of understanding or a second output controller.
- Contact correction/versioning, subject identity, household separation, offered capacity, active occupancy, reschedule identity, cancellation history/24-hour boundary, stop/emergency fences and durable booking results are actionable.
- Capability scope is retained. The model tables are a useful basis for strict discriminated request schemas; implement `tool`/`status` as the declared unions rather than leaving public `string` placeholders in final shared contracts.
- Before the runtime switch, require the first vertical slice's public API/database and adapter checks to pass. After the switch, keep repeated Live text/audio and microphone/listening evidence separate from deterministic completion, as the plan already requires. Management/follow-up stages must not be claimed complete from booking-foundation tests.

No finding requires reviving legacy intake gates or introducing a framework. The fixes belong in the companion contracts and focused observable tests before code depends on those boundaries.
