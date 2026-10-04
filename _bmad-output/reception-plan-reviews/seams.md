# Before-code plan review — contract seams

Final verdict: PASS after contract corrections. All three original P2 gaps below are resolved. No remaining blocking seam was found in this before-code rereview. The selected architecture and migration strategy remain appropriate. No runtime source was edited.

## Resolution rereview — 2026-10-03

`end_session` now requests only pending media close; the adapter performs `/close` after farewell queue drain, cancels pending close on new input, and uses immediate `/close` for UI Stop. Failed/disconnected farewell abandons the pending media close and exposes restart. This separates interruptible farewell from the transactional domain fence.

Contact/name now exist at session scope without a draft. Draft contact is explicitly a projection rather than another mutable store, and subject switching requires explicit shared-contact inheritance. Lookup/callback intake therefore does not require a booking draft.

`/events` is now idempotent telemetry returning `{status:'ok'}` without advancing snapshot.version. The common event sequence/input-onset convention also binds acceptance to actual prior exposure rather than a later tool timestamp; muted audio and rendered text are distinguished. Dependent acceptance can flush exposure without manufacturing a stale semantic version.

Additional corrections define summary-link select/offer/accept/commit, operation-independent retrieval for lost follow-up event results, local time windows, and shared streaming callback/recorded-output interfaces. These strengthen implementation boundaries without expanding to a generic workflow. Existing proposed race/lookup tests remain useful implementation acceptance cases. This is a static contract review; runtime and actual provider attribution remain to be verified during implementation.

## P2 — Domain end and interruptible farewell specify incompatible timing

The `end_session` contract establishes the admission fence and closes the uncommitted draft, while its same row says new caller speech can cancel pending media close **before domain end**. The adapter must invoke the function before Gemini receives its result and produces farewell audio. If that function immediately closes the domain session, a later interruption can cancel audio closure but cannot resume the request. If it defers domain closure, it does not implement the stated immediate fence.

Minimal correction: distinguish a reversible farewell intent from irreversible explicit end. Define who finalizes the domain close and when. For example, `end_session` requests a pending farewell, and the adapter issues a transport-owned close command after output completes unless a newer caller turn cancels it; UI Stop uses immediate close. Alternatively retain immediate domain close and explicitly require a fresh domain session after interrupted farewell. Select one concrete behavior consistent with the approved interrupted-goodbye scenario. Add one event-sequence test asserting both domain and media behavior.

## P2 — Contact ownership does not support lookup before an appointment draft

`ReceptionSnapshot` contains contact only inside an optional appointment draft. `capture_contact` and `confirm_contact` have no context selector. Yet `find_my_appointments` requires a dictated lookup phone to be confirmed, and callback/transfer can occur before any slot/action exists. Two compliant implementations can disagree: one creates a booking draft to hold lookup contact, while another rejects confirmation because no appointment draft exists. This reintroduces unrelated booking intake for an inquiry or prevents the management/follow-up paths.

Minimal correction: define session-owned caller contact capture independently of the appointment draft, or explicitly define a small standalone contact resource/context key. Specify how a draft inherits the confirmed caller contact and when proxy/subject contact becomes distinct. `find_my_appointments` must verify the supplied phone against the confirmed lookup contact version (or immutable calling metadata), rather than accept arbitrary model-supplied digits. Summary links retain their separate selected-appointment contact rule. Add a no-draft lookup using chunked dictated phone and a callback-before-slot test.

## P2 — Flushed media events lack a version/response convention

The carrier uses `expectedVersion`, and the adapter must flush exposure events before submitting acceptance. `/events` specifies neither a result/snapshot nor whether telemetry advances the session's semantic version. A server that increments version for every persisted session event follows serialization literally; an adapter that preserves its last tool snapshot while flushing events then sends acceptance with a stale version. Every acceptance attempt can conflict even though there was no concurrent semantic edit.

Minimal correction: specify that append-only exposure/input telemetry does not advance the draft/session edit version, or define `/events` to return the updated snapshot/version and require the adapter to adopt it before dependent commands. Deduplicate event ID plus canonical fingerprint and allow legitimate exposure progression for the same output; do not make delivery events themselves approval. Add a flush-started-event → accept-offer test verifying no artificial version conflict.

## Inspected and coherent

Subject/name versus contact revisions, event fingerprint deduplication before stale checks, automatic operation preparation, saved-result lookup before stale carrier rejection, transactional capacity/close fence, separate active occupancy/history, and isolated replacement DB are coherent in the written contracts. A `ready` operation read after an HTTP timeout is not a terminal failure; the existing same-ID retry/reconciliation rule should be carried directly into tests. Exact route schemas and implementation details beyond the three seams above can proceed in the planned modules.

Review basis: `_bmad-output/plan-reception-replacement.md`, `_bmad-output/reception-contracts.md`, and the approved architecture spine. Static adversarial review only; no runtime tests or code edits.
