# Architecture alternatives — adversarial seam review

Final verdict: PASS. Both original P2 contract ambiguities below are resolved in the revised spine. No blocking seam remains in this design review; implementation signatures and provider probes remain the explicitly deferred next step. The resource-centered choice is proportionate for the prototype. This verdict does not certify the unchanged runtime or live speech behavior.

## Resolution review — 2026-10-02

AD-3 now explicitly distinguishes issuance from offer presentation, ties semantic acceptance to the presenting assistant output and subsequent caller input, and distinguishes not-started/started/interrupted/completed exposure. The shared attribution convention uses adapter-issued event/input/output IDs. This closes the issuance-only versus media-exposure ambiguity without requiring a final caption or complete playback. Interrupted/uncertain exposure remains semantic clarification context; neither telemetry nor model assertions are represented as proof of understanding.

AD-6 chooses a clear commit fence: uncommitted requests cannot commit after explicit end or emergency override, and commit validates active session/request status in its transaction. Results linearized before the fence remain retrievable; delayed preparations cannot revive the request. This is a simpler valid resolution than the initial review's suggested pre-close admission/settlement split. Emergency preserves draft details but invalidates uncommitted consent/operations, with correction requiring a new revision; explicit end closes the draft.

The stable server-issued subject key, separate contact versions and explicit Saudi `05…` canonical format clarify the other inspected seams. No further blocking requirement is needed at architecture altitude. Review method: static reread of the revised spine; no implementation changes or runtime tests.

## P2 — Offer issuance and caller-turn ordering lack a shared exposure boundary

Relevant rules: AD-2, AD-3; comparison's interrupted audio and changed-time acceptance scenarios.

Component A: the offer service issues an immutable offer during a tool call and treats any later adapter-issued caller-turn ID as subsequent. It accepts semantic acceptance referencing that offer and matching subject/selection revisions, using delivery telemetry as informational context. This meets the currently stated identifier/revision/turn-order checks and avoids caption matching.

Component B: the media adapter streams speech immediately, cancels queued audio on interruption, and emits a new input-turn ID for the interruption. The offer result can have reached Gemini even though none of the offer was played or shown to the caller. This meets AD-2 and has no whole-turn playback gate.

Together: the caller interrupts with agreement to a different preceding question, or says “yes” before the newly selected offer has been exposed. Gemini supplies acceptance for the newly returned offer. Every revision and issuance-based ordering check passes. The draft can commit despite the supposedly accepted offer having been entirely cancelled before exposure. A semantic misunderstanding is an acknowledged limitation, but this case also lacks a deterministic shared definition of what “subsequent” is subsequent to. Merely logging delivery context does not resolve that disagreement.

Minimal clarification: identify the offer presentation attempt and its connection/output event boundary in the acceptance contract. Define how an entirely unexposed/cancelled attempt differs from a partially exposed or fully exposed offer, including typed presentation. An entirely unexposed offer cannot be accepted through that attempt; after interruption the model may naturally re-present the same immutable offer. Partial exposure can remain contextual rather than introducing a mandatory complete-playback gate. Specify whether the ordering baseline is issuance, presentation start, or another adapter-observed event. Do not use captions as approval evidence or claim that exposure proves understanding.

Validation scenario: issue offer → cancel all associated output before exposure → receive a new caller turn → submit acceptance. It must require a valid presentation attempt rather than commit. Separately demonstrate ordinary streamed speech and acceptance without waiting for a full audio turn or final ASR caption.

## P2 — Closing needs an admission fence distinct from operation settlement

Relevant rules: AD-5, AD-6; comparison's stop/reconnect and bounded recovery requirements.

Component A: a session service serializes session updates with versions and marks the session ended. It rejects all later domain updates, applying “Explicit end prevents later domain updates for that session” literally.

Component B: an operation service has prepared an immutable operation ID, accepts a commit already dispatched by the browser, and performs its acceptance checks, effect and result transaction after the end request reaches the session service. It considers the operation already started and therefore eligible for reconciliation. This applies the other half of AD-6 literally.

Together: if A rejects B's transaction, an operation accepted before close cannot settle consistently. If B proceeds after A declares the session ended, an appointment appears after the supposedly terminal state. Both obey their local reading; session version checks alone do not define which request owns admission. Reconnect also needs to distinguish an unresolved closing session from an active session that may accept new edits.

Minimal clarification: define one server-side close/admission boundary. “Started” means admitted by the server before that boundary, not merely sent by the browser or given a prepared operation ID. Closing rejects new operation admissions and draft edits, permits only settlement/result lookup of previously admitted operations, and abandons remaining uncommitted drafts after reconciliation. If bounded recovery remains unresolved, preserve the operation and closing status for later reconciliation instead of treating it as an ordinary resumable draft. A small persisted envelope status plus an admission/version check is sufficient; no queue or dialogue stage machine is required.

Validation scenarios: prepared but unadmitted operation versus close; admitted commit versus close; lost committed response versus close; unresolved close followed by reconnect. Assert admission outcomes, occupancy and durable result, and ensure reconnect cannot reopen a closing session for a new mutation.

## Other inspected seams

Subject/selection and contact revisions are separated coherently: completing a missing name/contact for the same subject preserves selection acceptance, while replacing the subject invalidates it. The next schemas must give each subject a stable server-issued handle rather than use name or phone as identity; this is an implementation of the existing rule, not another architecture requirement.

Operation IDs bind validated payload and expected versions, and contact repair invalidates a prepared payload without invalidating unchanged selection acceptance. Durable result lookup must honor the stated same-ID/same-payload recovery rule even when the current draft has subsequently changed. Simulated notifications belong to the same transactional local effect record, so the design does not promise exactly-once delivery by an external service.

No runtime code or design documents were changed. This review uses static adversarial construction; it does not claim implementation or live Hejazi speech validation. Exact field schemas remain the next-step implementation work, but the two shared semantic boundaries above should be decided in the spine first.
