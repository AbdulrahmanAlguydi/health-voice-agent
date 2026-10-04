# Reception replacement contracts

Implementation contract, 3 October 2026. Applies to the replacement only; no old booking gates are part of this API. The synthetic simulation remains local.

## Public HTTP boundary

`POST /api/reception/sessions` accepts `{callingNumber?: string}` and returns a `ReceptionSnapshot`. `GET /api/reception/sessions/:id` restores that snapshot. `POST /api/reception/sessions/:id/tools` accepts `ReceptionCommand` and returns `ReceptionResult`. `POST /api/reception/sessions/:id/events` accepts `ReceptionMediaEvent`. `GET /api/reception/activity` returns recent simulated effects/appointment summaries. These routes use an independently opened replacement database.

`POST /api/reception/sessions/:id/close` performs the actual domain fence, accepting `{eventId, expectedVersion, intent?, outcome}`. `GET /api/reception/sessions/:id/events/:eventId` retrieves a deduplicated command result, including follow-up effects whose response was lost before an operation ID became known. Return not_found only when no event was admitted; otherwise retrieve its result or explicitly unresolved status.

```ts
type ReceptionCommand = {
  eventId: string; expectedVersion: number; tool: string;
  args: Record<string, unknown>;
  context: { connectionId: string; inputTurnId: string; inputSequence: number;
    eventSequence: number; inputStartedEventSequence: number;
    outputId?: string; exposure?: 'not_started' | 'started' | 'interrupted' | 'completed';
    source: 'text' | 'microphone'; attribution: 'known' | 'uncertain' };
};
type ReceptionMediaEvent = {
  eventId: string; connectionId: string; outputId: string;
  inputSequence: number; eventSequence: number; medium: 'audio' | 'text';
  exposure: 'not_started' | 'started' | 'interrupted' | 'completed';
  offerIds: string[];
};
type ReceptionSnapshot = {
  sessionId: string; version: number; status: 'active' | 'paused' | 'closed';
  callingNumber?: string; clock: { nowIso: string; timeZone: 'Asia/Riyadh'; localDate: string };
  directory: Array<{doctorId: string; nameAr: string; nameEn: string; specialtyId: string;
    specialtyAr: string; specialtyEn: string}>;
  clinic: Record<string, unknown>; patientName?: string; contact: ReceptionDraft['contact'];
  draft?: ReceptionDraft; offers: ReceptionOffer[];
  operations: Array<{operationId: string; status: 'ready' | 'committed' | 'rejected'; result?: Record<string, unknown>}>;
};
type ReceptionDraft = {
  draftId: string; action: 'book' | 'reschedule' | 'cancel' | 'summary_link'; subjectKey: string;
  subjectRevision: number; selectionRevision: number;
  patientName?: string; callerName?: string; relationship?: string;
  doctorId?: string; serviceId?: string; targetAppointmentId?: string;
  acceptedOfferId?: string; operationId?: string;
  contact: {rawChunks: string[]; digits: string; version: number; confirmedVersion?: number;
    source: 'simulated_web_field' | 'dictated'; issue?: string};
};
type ReceptionOffer = {
  offerId: string; draftId: string; action: 'book' | 'reschedule' | 'cancel' | 'summary_link';
  subjectKey: string; subjectRevision: number; selectionRevision: number;
  appointmentVersion?: number; doctorId: string; slotIds: string[]; startsAtUtc: string;
  doctorNameAr: string; doctorNameEn: string; issuedInputSequence: number;
  expiresAt: string; labels: Record<string, unknown>; consequence?: string;
};
type ReceptionResult = {
  status: string; facts?: Record<string, unknown>; issues?: string[];
  missingFields?: string[]; snapshot: ReceptionSnapshot;
  operationId?: string; result?: Record<string, unknown>;
};
```

Exact status union is governed by server result schemas: `ok`, `offers`, `updated`, `needs_details`, `needs_clarification`, `invalid_contact`, `unknown`, `not_found`, `ambiguous`, `conflict`, `unavailable`, `ready`, `committed`, `rejected`, `paused`, `closed`, `error`, `unresolved`. Event lookup distinguishes `not_found` (never admitted) from `unresolved` (admitted without a saved outcome). Transport failure is `outcome_unknown` locally, never evidence of failure.

Pending booking results (`offers`, `ready`, `needs_details`, `invalid_contact`, or `needs_clarification`) include lifecycle facts: `offerAccepted` reflects whether the active draft retains an accepted offer, while `bookingStatus: 'not_booked'` means no appointment has been created yet, including when status is `ready`. `appointmentSaved`, `slotReserved`, and `capacityHeld` remain `false` until a successful `commit_request` returns `committed`. `requiredFunction` identifies the next tool for a missing or invalid field, or `commit_request` when a ready operation is available. These facts supplement the existing status, `missingFields`, and `issues`; they do not make ordinary speech prescriptive.

## Model functions and argument contracts

All functions optionally accept `language: 'ar'|'en'`. IDs are internal, not spoken. Request carrier fields above are assigned by the adapter, never model arguments.

| Function | Model arguments | Behavior |
| --- | --- | --- |
| `clinic_information` | `query?: string, doctorIdentifier?: string, specialty?: string` | DB facts only; bilingual directory/services/policies/mappings. Uncovered facts return unknown. |
| `find_available_slots` | `doctorIdentifier: string, serviceId?: string, date?: YYYY-MM-DD, fromDate?: YYYY-MM-DD, toDate?: YYYY-MM-DD, fromTime?: HH:mm, toTime?: HH:mm, exactTime?: HH:mm, dateExpression?: string, calendar?: gregorian|hijri` | Resolve supported relative/Hijri dates in server code with injected clock; unsupported/ambiguous phrases clarify. Validate the Riyadh window (lower inclusive/upper exclusive). Without `exactTime`, return up to three duration- and occupancy-aware `availabilityWindows` of 15-minute appointment start times, with no offer IDs or consent eligibility. An exact-time lookup must cover exactly one date; a missing or multi-day date scope returns `needs_clarification` (`exact_time_requires_single_date`). For one date, recheck capacity and return the matching precise, non-held offer if available. Past and too-soon capacity is never returned. |
| `set_booking_details` | `patientName?: string, callerName?: string, relationship?: string, newSubject?: boolean, serviceId?: string` | Same-subject name patch preserves slot acceptance; explicit newSubject changes key and invalidates approval. |
| `capture_contact` | `mode: append|replace|restart|correct, rawText?: string, startIndex?: number, deleteCount?: number` | Preserve raw chunks; zero-based corrections; event-deduplicated partial capture. No silent padding/guessing. Complete new full number replaces prior partial, never concatenates two full numbers. |
| `confirm_contact` | `contactVersion: number, decision: accept|decline|unclear` | Accept exactly that canonical version after subsequent caller turn; known calling field needs no dictated readback. |
| `accept_offer` | `offerId: string, decision: accept|decline|change|unclear, detailsCommunicated: boolean` | Offer-specific semantic decision; subsequent known caller turn, matching subject/selection/target versions. Never-issued/never-exposed and uncertain carrier return clarification, no ASR waiting. |
| `commit_request` | `operationId: string` | Ready operation is issued automatically when accepted offer + needed details validate. Retrieve saved result before checking stale carrier version. Validate current versions/status/capacity in transaction, store result/effects atomically. |
| `get_operation` | `operationId: string` | Return current same-session result, no write replay. |
| `find_my_appointments` | `phone?: string, patientName?: string` | Confirm dictated lookup phone or reuse known calling metadata. Return candidates, never merge by shared phone. |
| `select_appointment` | `appointmentId: string, action: reschedule|cancel|summary_link` | Snapshot target/version; cancellation offer includes policy consequence, reschedule awaits real replacement opening. Summary-link offer binds that appointment and its stored contact; accept_offer + commit_request saves the simulation without disclosing clinical content. |
| `record_followup` | `kind: waitlist|callback|transfer, reason?: string` | Persist only validated contextual contact/name; report locally simulated result. No real delivery or invented deadline. Same-event retries/retrieval recover exactly one effect. |
| `set_emergency` | `active: boolean` | Pause routine admissions and invalidate uncommitted acceptance/operations. Preserve committed results and valid draft details. False resumes new revision after correction. |
| `end_session` | `intent?: string, outcome: completed|declined|unresolved|emergency` | Request a media close only, not the domain fence. Adapter waits for farewell playback to drain, then calls /close. New caller input cancels pending close. Explicit UI Stop calls /close immediately; unexpected disconnect retains the active server session. If farewell playback fails/disconnects, abandon pending media close and expose restart rather than claiming delivery. |

## Acceptance and mutation rules

Transport IDs/sequence identify activity without waiting for captions. Local VAD/typed send/provider activity creates an input turn; if attribution is uncertain, a mutation needing consent returns one clarification rather than manufacturing a fresh turn. Media events are flushed before a tool referencing them; sequential tools in one batch receive updated snapshot versions. Offer issuance alone is not presentation. Known started output plus Gemini's semantic assertion is the prototype acceptance convention, not independent proof of hearing. Interruption is contextual, not a blanket invalidation.

Broad availability is discovery only: `availabilityWindows` describes inclusive start-time endpoints and the 15-minute interval for the selected service. A range is not a specific offer and cannot be accepted. The patient chooses an exact start, the server rechecks it, and the agent presents that exact doctor/date/time before one clear agreement. The synthetic schedule is generated lazily for the searched doctor across its configured 30-day horizon; tests use disposable databases and may include past capacity to prove it is filtered.

Media events are idempotent, non-domain-versioned telemetry: POST returns `{status:'ok'}` and does not bump snapshot.version. Associate returned offer IDs with the next assistant output before exposure. If `accept_offer` returns `needs_clarification` while that offer remains active, the adapter associates the active offer with the next assistant output so the agent can naturally restate the same offer; this association never accepts or books it. For bookings, prompt guidance asks the agent to restate the doctor, exact date and time, then wait for a fresh caller turn. Audio exposure begins only at actual scheduled source start; muted audio is not audio exposure. Rendered text is separate text exposure. Adapter monotonically sequences input onset and exposure; acceptance requires its inputStartedEventSequence later than presenting exposure, not just a later tool-call timestamp. Late old tool requests after a newer input are marked uncertain, not relabelled as a fresh caller confirmation. Without definitive provider causality, uncertainty is explicit and one clarification is required. Started output plus Gemini's semantic assertion remains a prototype convention, not independent proof that the exact facts were spoken or heard.

Session contact/name exist independently of any draft so lookup/callback flows can collect/confirm them without forcing booking. Draft contact is a snapshot projection of the same session contact, not a second mutable store. Changing the patient subject retains the caller's known session contact unless the caller requests a different contact; this avoids re-dictation for household bookings. Each subject still has its own identity and consent. Never merge patient identity by phone; summary links use the selected appointment's stored contact.

Given an issued offered slot at caller sequence N, acceptance must belong to a known caller sequence greater than N and a presenting output associated with that offer. Contact confirmation similarly references a later turn than capture. Collection of contact/name can make an already accepted slot ready; it never requests another appointment yes. Changing selection/person/action invalidates that acceptance. Overall snapshot versions serialize edits; independent selection/subject/contact versions preserve unrelated facts.

Event deduplication checks identical event ID + canonical request fingerprint before stale-version rejection. Changed payload under one event ID conflicts. Operation IDs bind a frozen validated payload; corrections invalidate uncommitted operations. Retry commit with that same ID after unknown outcome; do not mint another. Close/emergency and commit use the same immediate transaction fence. A commit that completes first stays committed; a close that completes first prevents pending admission.

## Domain/database and migration

Separate compatible bilingual catalog, fictional clinic knowledge/services with duration/lead time/horizon and routing, sessions/drafts/offers/operations/events, patient subjects, appointment records/version/history, active capacity occupancy and simulated effects. Reuse current 30-doctor/10-specialty fictional catalog—not the supplied clinic records. No permanent unique historical appointment slot constraint. Each service occupies all contiguous returned capacity units for its duration. Cancel releases active occupancy; move is atomic on existing appointment ID. Synthetic less-than-24h no-show classification is separate from cancellation/status and exactly 24h is not late.

Browser controller is new, gate-free, implementing existing SessionControllerApi. Add streaming callbacks/player methods; keep neutral recorded turn data compatible with bubble replay. Old controller stays only in archived/legacy tests, not the default web path or token constraints. Token service uses the new prompt/tools in the actual runtime; injected legacy token/config fixtures remain explicit. New DB path defaults to `data/reception.sqlite`; existing `DATABASE_PATH` remains the legacy backup source, not migrated destructively.

Neutral media interfaces: `RecordedOutput = {transcript:string, language:'ar'|'en', audio:Array<{data:string,mimeType:string}>, verification:'not_required'}` (verification is compatibility metadata, not a gate). Controller callbacks add `onStreamStart(outputId,onStarted,onFinished,onFailed)`, `onStreamChunk(outputId,chunk)`, `onStreamEnd(outputId)`, `onRecordedOutput(outputId,output)`, and optional fourth `outputId` on onAssistantTranscript. Player methods add `beginStream(outputId,onStarted,onFinished,onError):Promise<void>`, `enqueueStream(outputId,chunk):Promise<void>`, `endStream(outputId):void`; stop cancels every scheduled source and stale generation. Finish only after generation ended and queue drained. App associates transcripts/replay records by outputId regardless of arrival order. Existing injected legacy callbacks/players continue working for their fixtures; actual new runtime uses streaming callbacks.

Readiness and bounded recovery are data results, not rigid conversational phases. Http timeout is 8 seconds, automatic transport retry once with same event ID; commits reconcile via get_operation before any new mutation. Provider reconnect once using server snapshot, no automatic write replay; surface a restart notice if that fails. No unsupported async/resumption feature is required. Exact user-transcript attribution and streaming audio get independent adapter tests and actual Live/microphone trials.
