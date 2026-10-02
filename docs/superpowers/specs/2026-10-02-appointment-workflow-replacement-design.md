# Appointment workflow replacement — design

Status: written design for user review. Not implemented. The overall direction and expanded appointment-management scope were accepted in discussion; this document consolidates the refinements and explicitly excludes emergency directions to fictional facilities.

## Goal and constraints

Build a natural Arabic-first, English-capable receptionist using one Gemini Live session and persistent synthetic clinic data. Replace the previous booking orchestration instead of layering another controller over it. Adapt the supplied working-agent prompt; retain its useful behavior without copying its clinic records, prerecorded media, exact ordinary replies or unsupported infrastructure assumptions.

Keep the existing web interface, microphone and text testing, complete transcript history, automatic scroll and audio replay. Keep direct browser-to-Gemini audio, Express, TypeScript and SQLite. No additional conversational model, output judge, LiveKit, real telephony, actual messaging, payments, hospital integrations or external search. Existing provider usage is still a real API interaction with its usual cost.

All clinic/person/appointment records are fictional. Preserve the current implementation and database before replacement. Keep the old database intact; the replacement uses a separate synthetic database. API credentials stay out of prompt snapshots, Git and logs.

## Scope

Doctor/specialty information; clinic hours/location/insurance/policies; service lookup and prices; light symptom-to-specialty signposting; new booking; existing appointment lookup; rescheduling; cancellation; proxy bookings; sequential multi-person bookings; waitlist; callback requests; simulated notifications, transfer outcomes and visit-summary links. Clinical records are never spoken or interpreted. Simulated link delivery contains no actual medical content or access to real records.

Use the current fictional clinic brand, مجمع عافية الطبي / Afiyah Medical Center. Store a fictional Jeddah location in clinic metadata for ordinary demo directions, not emergency routing. Preserve the test scale of 30 doctors and 10 specialties; use our own compatible synthetic records and small bilingual service/knowledge/routing catalogs, not the pasted clinic's records or 1,826-service catalog.

## Responsibility boundaries

1. Browser media adapter: microphone, native streaming playback, immutable transcript turns, replay, provider messages, connection lifecycle and delivery events. It transports function requests and renders server snapshots; it does not maintain separate authoritative approval/draft flags.
2. Gemini: understands conversation, interprets acceptance/corrections, mirrors language, asks focused questions and speaks naturally. It receives a concise persona, database-derived facts and function descriptions. It does not invent clinic information or have direct SQL access.
3. Server action context: one session record owns current patient subject, supplied contact/name, offered options, action revision, acceptance, active operation and results. It preserves unrelated details when one field changes and serializes mutations.
4. Domain functions: knowledge/directory, availability, contact capture, appointments, waitlist and callbacks. Each produces structured results: status, authoritative facts, missing fields, validation issues and recovery options. Business rules are enforced here, not through spoken word matching.
5. SQLite: persists synthetic clinic facts, sessions/actions, appointments/history, active occupancy, operation results and simulated effects. No distributed workflow infrastructure is required.

## Prompt and voice

Use professional conversational urban Hejazi Arabic with short, direct turns and a consistent voice identity. Start in Arabic and switch for a clear English sentence/request; numbers or a single mistranscribed alo/hello do not alone change an established language. Names/titles and spoken labels match the active language. Avoid gender assumptions from uncertain speech.

Generate the greeting live once; no claim that a prerecorded opening already played. Ordinary questions and acknowledgements are not fixed strings. Reuse details already given, one question at a time. After one completed request, ask whether more help is needed and wait; clear goodbye ends after farewell delivery. Be truthful if asked whether the assistant is AI.

No sentence-level output approval gate. Normal audio streams as generated; diagnostics can observe inconsistencies without holding every reply. Date/phone values are code-generated, but Gemini retains conversational wording. This does not guarantee pronunciation, dialect or spoken factual correctness.

## Clock and facts

The server supplies current ISO time, Asia/Riyadh, local day/date at startup, reconnect and time-sensitive function results. Refresh date context safely across midnight. Resolve relative windows and Gregorian/Umm al-Qura Hijri labels in code, using an injectable clock. Clarify genuinely ambiguous dates/windows rather than guessing. Recheck lead time, published horizon and occupancy at each write.

Preload compact stable doctor/specialty/clinic facts from SQLite with a version. Query larger details when needed. Schedule summaries are not live availability; offered slots must originate from the availability function. Facts from callers are preferences/corrections, not permission to override stored clinic facts.

## Lightweight routing and emergency phase

Routing uses synthetic database mappings, not unrestricted medical knowledge. When the caller requests a specialty/doctor, proceed without symptom questions. If routing is requested, use volunteered details and at most two short clarification questions. Offer the listed department(s) and let the caller choose. Do not diagnose, assess urgency, rank providers or promise medical suitability. Unclear/uncovered requests use simulated reception/callback rather than more questioning.

An emergency phase overrides routine management for an explicit current emergency or clearly described current potentially life-threatening situation. Distinguish current reports from hypotheticals, historical events, quoted text, negation and information questions. One short current-versus-hypothetical clarification is permitted only when unclear, not before responding to clear immediate danger. Do not implement this as a bare keyword match or an emergency questionnaire.

Give a brief response directing the caller to the nearest emergency department/local emergency services, not the fictional clinic address. Do not claim assistance was dispatched, create an ordinary booking or offer a delayed callback as the emergency response. Preserve saved results and stop unfinished routine writes. A correction of misrecognition can restore the prior conversation context. Any emergency number included later must be verified against an authoritative local source. No prerecorded emergency media is needed.

## Booking and confirmation

Default to booking for the caller. Names may be a single usable name. No mandatory patient-ID or date-of-birth step. No caller number is inherently known in a browser session; only a marked synthetic scenario can supply one.

Offer one actual suitable opening with doctor/date/time. Clear acceptance confirms that offer; collect remaining name/contact details without another appointment readback. A caller-proposed or changed appointment must be checked and offered/accepted before committing. Reject stale offer/action revisions, and never treat agreement with a service or phone number as agreement to another appointment.

Record offer delivery and acceptance separately. A visible bubble alone is not proof the voice caller heard the offer. An interruption by itself is neither refusal nor consent; clarify genuinely incomplete details without erasing valid intake. The provider's semantic report and subsequent input-turn attribution replace waiting for an independently arriving transcript to match an expected phrase. They do not independently prove the model interpreted consent correctly.

Contact capture accumulates partial phone dictation, supports correction/restart and supported repeated/grouped number forms, preserves zeros, and returns the actual digit count and spoken readback. Confirm a dictated complete number once. Local Saudi 05 numbers require ten digits; other supported international forms have explicit validation rather than silent trimming/padding. Use at most two capture failures before changing approach; persistent failure offers a simulated callback/transfer rather than a loop.

Prepare/collect state is not a reservation. Commit only with the relevant accepted offer, complete validated details and a current server action revision. Create patient/profile and appointment atomically. Only report success after the result is known; booking references and internal IDs are not routinely spoken.

## Existing records and multiple people

Phone-based lookup is a deliberately simplified prototype convention, not real authentication. One phone can identify several patient bookings. Disambiguate by patient/doctor/date only as needed, rather than merging patients or acting on all matches. Proxy bookings store the patient name, caller name and stated relationship; reuse the relationship already volunteered. Do not require national identifiers.

Handle multiple people one at a time, with separate accepted offers and results. Reuse applicable contact/preferences without assuming every choice is shared. Offer adjacent slots only if returned as available. Preserve partial success when a later member's booking fails.

## Mutation behavior

Each mutation has a server-issued operation ID and expected revision. Repeated identical requests return their stored result. Reusing an ID with changed arguments is rejected. A timeout/disconnection means unknown outcome until reconciled; never create a fresh operation merely to retry a possibly saved action.

Reschedule updates the existing appointment atomically and records history; a failed move preserves its old occupancy. Cancellation releases active occupancy while preserving the record. Enforce uniqueness on active occupancy, not all historical appointment slot references. Variable-duration services need contiguous returned capacity, not arbitrary times within a spoken range.

Use the requested synthetic cancellation policy: less than 24 hours' notice records a late/no-show classification; exactly 24 hours is not late. Keep this classification separate from active booking status, record the cancellation event and explain its consequence before acceptance where applicable. It creates no real-world penalty.

Waitlist and callback entries persist preferences/contact without claiming a booked appointment or inventing a response deadline. No automatic waitlist promotion. Simulated SMS, transfer and summary-link results appear in a local activity panel. Caller-facing claims must distinguish local simulated effects from real delivery.

## Transport, recovery and diagnostics

Stop queued audio on interruption. Provider tool cancellation does not undo an already committed database action. Cancel reads where practical, serialize writes and reconcile writes whose responses were lost. Configure resumption/GoAway/compression only after testing support with the exact model/token setup; reconstruct authoritative app context without replaying mutations when provider resumption is unavailable.

A failed field or function preserves other valid details and returns a focused repair. Retries are bounded, duplicate safe and observable. A failed greeting/playback never resets domain state. Stop close-after-playback if the caller speaks again; replay audio cannot rerun a write.

Log session/connection/turn/offer/operation IDs, prompt/config version, server clock, tool arguments/results, before/after snapshots, validation decisions, simulated effects and media lifecycle. Exclude credentials and routine audio base64. Measure tool dispatch/backend/result-to-audio/playback delays separately. The test UI provides transcript/log export and saved activity, not a large admin system.

## Test migration and acceptance

Archive the old implementation and tests before retiring obsolete expectations. Keep behavioral coverage for grounding, valid writes, language/date calculations, transcript history and replay. Rewrite tests tied to old APIs/flags. Delete requirements that only enforce patient-ID intake, duplicate final confirmation, exact ordinary lines or audio withholding.

Maintain a failure-to-test map: each known regression has a new behavior test or a documented obsolete requirement. Never delete a failing safety/data test simply to increase the passing count. Tests assert public domain outcomes and timelines, not private browser flags.

Test layers:

- Deterministic domain/API tests with isolated SQLite fixtures and injected clocks. Assert exact record counts, occupancy, revision and operation results.
- Adapter sequence tests with delayed/out-of-order transcription, interrupts, tool cancellations, reconnects and failures before/after commit. Add bounded generated action/correction/retry sequences to verify invariants.
- Repeated live Gemini Arabic/English text conversations scored by outcomes and tool traces, with varied normal wording rather than exact reply matching.
- Actual microphone/listening tests for Arabic numbers, dialect, pace, audio continuity, bilingual transitions and turn-taking. Text tests cannot certify voice quality.

Required cases: unknown facts/doctors/services; ambiguous names; unavailable and stale slots; changed-time yes; service yes versus slot yes; partial/repeated/corrected phones; shared household phone; wrong patient target; midnight/December-to-January/Hijri; reschedule conflict; cancel/rebook; 24-hour boundary; duplicate/lost-result writes; partial multi-person success; waitlist/callback failure; goodbye/new question; emergency true/false triggers; routing with zero/one/two clarification questions.

Before expanding features, prove a new guest booking with a partial/corrected phone, one accepted offer, one phone readback, exactly one saved appointment and one simulated notification. Then add other domain functions incrementally. Run old failure scenarios with new expectations rather than preserving obsolete procedures.

A passing deterministic suite establishes application invariants, not a zero model-error rate. Report repeated live scenario success/failure and latency separately. No automated judge runs in the patient conversation path.

## References and rationale

See [workflow redesign exploration](../../workflow-redesign-exploration.md) for code evidence, alternatives, sources and the previous failure mechanisms. The main rationale is one authoritative action owner, flexible conversation, fewer procedural/output gates and recoverable mutations. A framework, extra model or larger prompt does not automatically solve these problems.
