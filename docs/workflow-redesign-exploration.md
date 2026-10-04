# Appointment workflow redesign — exploration

Status: research and proposed design, not an implemented feature or an approved detailed implementation plan. Updated 2 October 2026.

## Approved direction

Keep one Gemini Live voice model and the existing browser experience; replace the booking workflow. Include new bookings, appointment lookup, rescheduling, cancellation, proxy and sequential multi-person bookings, waitlists, and callback requests. All external effects remain simulated. Adapt the supplied working agent prompt rather than copying its architecture or clinic data.

## Evidence from our implementation

- `src/shared/geminiLiveConfig.ts` combines persona, examples, function declarations and procedural instructions. It still requires patient-ID selection and a later final-summary confirmation, conflicting with the supplied prompt's name/phone intake and single accepted offer.
- `src/client/agent/tools.ts` owns patient identity, selected availability, draft delivery flags and consent. `confirm_booking` waits for a final transcription and clears its pending ID before the confirmation HTTP response arrives. A lost response therefore needs reconciliation rather than another fresh booking attempt.
- `src/client/voice/session.ts` owns additional delivery/readback state and forwards audio to a complete-response output buffer. Its inspected message path handles interruption and tool cancellation, but does not handle GoAway or session-resumption updates.
- `src/shared/contactDigits.ts` supports individual digit words, not the supplied prompt's repeated-digit counts, larger spoken number groups or accumulated dictation across turns.
- `src/server/db/schema.sql` permanently makes appointment slot IDs unique and has no appointment status/history. Cancellation and rebooking require a changed occupancy design, not just another function.
- `src/server/services/slotService.ts` supports a requested day and up to six returned slots, not flexible date windows or service-duration-aware openings. Its returned prose encourages reading a list.

These are code observations, not proof that every previous live failure has the same cause.

## Architectural alternatives

1. Prompt-led functions with little application state: smallest change, but insufficient to reconcile corrections, retries, partial multi-person success and disconnected sessions.
2. One model with a compact server-owned action context: recommended. The model speaks freely; functions own business operations and expose facts, missing fields and recoverable errors. A few domain states constrain writes, not the wording or order of every conversational turn.
3. Generic workflow engine, agent handoffs or framework migration: defer. Full appointment management needs discrete domain services, but not another conversational model or a transport framework by default.

A browser-to-server Gemini audio relay was also considered. It centralizes transport but adds another audio hop and server connection lifecycle. Retain browser-to-Gemini audio and browser-to-local-server function requests unless the exact provider feature tests reveal a concrete limitation.

## Recommended boundaries

- Browser: microphone, immediate streaming playback, immutable transcript turns, replay, provider transport and delivery events. No competing authoritative booking flags.
- Gemini: interpret speech and context, preserve language and preferences, explain known facts, ask only for missing/unclear information, report acceptance or corrections through functions. No external web/search grounding.
- Server workflow: current subject, known contact information, offered options, active action, revision, consent attribution and results. Preserve valid unrelated details on correction. Hold one active mutation at a time; information questions may temporarily interrupt it.
- Domain services: directory/knowledge, availability, appointments, waitlist and callbacks. Appointment mutations run transactionally and use server-issued operation IDs.
- SQLite: fictional clinic facts, published bookable slots, persistent records, workflow snapshots and operation results. No message queue, vector database or event-sourcing platform.
- Simulation adapter: append notification/transfer/summary-link events to a local activity view. Never contact a real destination. Return whether an event is simulated, saved or failed.

## Clock and calendar

The server clock supplies an ISO timestamp, `Asia/Riyadh`, local date and weekday at session start, reconnect and every time-sensitive tool response. Refresh the model's context at a safe conversational boundary when the Riyadh date changes; do not generate an unsolicited spoken clock update. This requires no daily manual prompt edit.

The server resolves relative search windows and computes Gregorian/Hijri/relative spoken labels. Keep original caller wording alongside the resolved interval. Ambiguous phrases get a narrow clarification; prayer-related periods are not universally converted to a single fixed hour. Every write rechecks the live clock, lead time, published horizon and availability. Tests use an injected clock for midnight, year rollover and calendar boundaries.

## Prompt adaptation

Use a readable base prompt with role, Hejazi voice/register, bilingual behavior, conversation objectives, grounding and safety boundaries. Supply stable clinic context from SQLite at startup. For 30 doctors and 10 specialties, a compact name/specialty directory can be preloaded; detailed service information is queried on demand. Slot availability and appointment status are always refreshed through functions. All context carries its source/version.

Do not blindly shorten away the source prompt's useful constraints. Place argument conditions and error meanings in function descriptions, and put precise business rules in code. Avoid duplicate instructions and contradictory response examples. Dates and phone readbacks have exact values, while connecting words remain natural. No hardcoded ordinary greetings, acknowledgements or intake lines.

The supplied prompt includes inconsistent reception numbers and clinic locations, hardcoded date/time and caller identity, promises of SMS, and a preplayed opening. None describe our runtime. Replace them with truthful generated context. Do not claim Saudi data residency or legal compliance without evidence.

Preserve no diagnosis/treatment. The user subsequently requested symptom-to-specialty routing similar to the supplied agent. Proposed adaptation: administrative signposting using explicit synthetic clinic routing metadata stored in SQLite, not unrestricted model medical knowledge or a claim that a doctor is clinically appropriate. Offer listed specialties/providers when the mapping is clear and let the caller choose. Do not rank doctors, diagnose, assess severity or infer eligibility. Ambiguous/uncovered complaints receive a narrow clarification or simulated reception/callback; possible emergencies take priority over ordinary routing. These synthetic mappings are demo data, not clinically validated guidance. Verify any emergency contact information before adopting it. Honest AI identity answers remain required without repeating an unsolicited disclosure every turn.

## Consent, corrections and phone capture

- An offered real slot includes doctor/date/time. Its clear acceptance authorizes that specific slot; collecting missing contact details does not require another appointment confirmation.
- Keep slot approval separate from confirmation of dictated phone digits. A yes to the phone readback is not a new approval of another slot.
- Bind approval to a server-owned offer/action revision and a subsequent caller turn, not a word whitelist. Corrections to the appointment invalidate its slot approval; unrelated information questions and audio interruptions do not erase it.
- If an offer was interrupted before its details were delivered, clarify the incomplete details rather than silently treating it as accepted. A visible text bubble is not proof the caller heard audio.
- Gemini's interpretation of acceptance is still probabilistic. Turn sequencing and server revisions prevent stale/reused consent; they cannot independently guarantee semantic understanding without another judge or explicit UI confirmation.
- A single booking name is allowed. Phone ownership is a prototype convention, not real authentication. One phone may serve several patients; never merge them solely by phone.
- A phone capture operation retains partial digits, corrections and a canonical digit string. Deterministic helpers handle supported repeat/count/group forms. Ambiguous grouping remains ambiguous rather than being forced to ten digits.
- Saudi local numbers beginning 05 require ten digits. Define supported international input separately; do not silently assume the source prompt supports every country.
- No caller number is known in a web session unless a clearly marked synthetic scenario supplies it. Otherwise ask once. Clinical details and national identifiers are not required.

## Appointment-management invariants

- Reschedule preserves the existing appointment identity, atomically frees the old occupancy and occupies the new one. A failed move leaves the old appointment intact.
- Cancel changes status and releases occupancy; retain history. The user subsequently requested the supplied agent's late-cancellation rule. Make the synthetic policy explicit in SQLite: cancellation with less than 24 hours' notice records a late-cancellation/no-show classification. Keep the classification separate from active occupancy and the cancellation event so a future cancelled slot is actually released. Explain the consequence before approval when applicable; exactly 24 hours is not late. This is a demo clinic policy, not a general healthcare rule, and produces no real-world penalty.
- Enforce uniqueness for active slot occupancy, not all historical appointment rows. Variable-duration services occupy every required contiguous slot; a time range never implies arbitrary-minute bookability.
- A retried operation ID returns its existing result; changed arguments require a new action/revision. A timeout is an unknown result until queried, not evidence of failure.
- A waitlist entry is not a booking. Store preferences and contact; no automatic promotion or promise of availability. A callback entry is not an appointment and carries no invented response deadline.
- Finish each member's booking before the next; reuse only explicitly applicable contact/preferences. Adjacent slots are a preference, not a guarantee. Partial success is reported per person/action.
- Existing-appointment queries may return several household bookings. Ask which patient/doctor/day only when needed to identify the target; never mutate all matches from an ambiguous reference.
- End the web session only after farewell playback, unless the user hangs up. New user speech before closure cancels pending close. Completed actions survive session end; unfinished actions do not commit.

## Recovery, latency and logs

Normal speech streams without waiting for a completed output transcript or an approval checker. Local booking-status diagnostics run asynchronously; they do not withhold every reply. Wrong spoken claims remain a model limitation, while actual writes are constrained by the server.

Interruptions stop queued playback and cancel read-only work where practical. Provider tool cancellation is not a rollback of an already committed database action. Serialize mutations and reconcile their results after cancellation/disconnection. Reconnect using provider resumption where the configured model/token permits it; otherwise rebuild context from the server without replaying writes. Retry boundedly and offer a locally saved callback if the requested operation cannot complete.

Measure request-to-tool-call, backend duration, result-to-first-audio and first-audio-to-playback separately. Cache stable directory facts; do not speculate by issuing a booking before consent or add a prerecorded hold line. Google documents synchronous versus asynchronous function support differences, so prove capabilities with our exact configured model rather than assuming background tool speech is supported.

Logs correlate session, provider connection, turn, offer revision and operation IDs. Include tool arguments/results, clock, before/after state, audio delivery milestones, reconciliation and simulated effects. Exclude credentials and routine audio base64. Add a small activity panel for appointments, callbacks and simulated messages, not an administration platform.

## Test strategy and rollout

Before changing runtime behavior, snapshot the current prompt/configuration, implemented source (including currently untracked files), documentation and a consistent SQLite backup. A Git commit alone does not capture ignored databases or environment configuration. Never write secret values into documentation or Git.

Use a separate new synthetic database. First prove a vertical flow: doctor question, one slot offer, accepted slot, partial/corrected phone, single readback, exactly one booking and locally recorded simulated notification. Then add move/cancel, proxy/multiple bookings, waitlist/callback and simulated link/transfer behaviors behind the same domain interfaces.

Maintain three test layers: deterministic domain/event tests, varied live-model Arabic/English text conversations, and actual audio/listening tests. Assert database results and tool timelines, not just pleasing transcripts. Repeat key live scenarios; do not call one successful conversation proof of reliability. No automated grader in the runtime path.

Regression scenarios include midnight/year rollover, relative/Hijri ambiguity, absent doctors/services, gender/language corrections, repeated names, interrupted offers, delayed ASR, phone groups across turns, wrong-time acceptance, stale availability, disconnect after commit, duplicate calls, service duration, occupied destination on reschedule, cancellation/rebooking, two people sharing a mobile, partial multi-person success, callback failure and goodbye followed by another question.

Add routing tests for explicit mapped requests, unclear/multiple symptoms, unsupported specialties, caller-selected providers outside a suggested category and emergency precedence. Add cancellation tests immediately below, exactly at and immediately above the 24-hour boundary.

### Latest scope refinements

- Routing is deliberately light: use details already volunteered; ask at most two short administrative clarification questions. If still unclear, do not start a symptom questionnaire. Offer simulated reception/callback rather than inventing a medical conclusion. A named specialty/doctor does not require symptom questions.
- Emergency handling is brief, not a triage conversation. Trigger on an explicit current emergency affecting the caller or another person, or a clearly described current potentially life-threatening situation. Distinguish a current report from a hypothetical, quotation, historical event, denial or a question about emergency services. Do not trigger merely because the caption contains the word emergency. When uncertain, one short clarification about whether it is happening now is sufficient; do not clarify a clearly stated immediate danger before responding.
- The fictional Jeddah clinic address is for ordinary simulated clinic directions only. Never direct a real emergency to invented coordinates or a fake facility. In the emergency phase, stop the routine action, give brief guidance to the nearest emergency department/local emergency services, and do not claim to dispatch assistance or save an appointment. Preserve already committed actions. If the caller corrects a misrecognition or says the scenario was hypothetical, leave the phase without losing the earlier request. Do not hang up before delivering the safety message.
- Old tests are not a compatibility target. Retain behavioral invariants, rewrite fixtures and event sequences, and retire tests whose only purpose is enforcing obsolete patient-ID steps, exact spoken copy, a second appointment confirmation, browser draft flags or output withholding. Archive the previous suite with the implementation backup before removing obsolete tests.
- Every retired failure-focused test should map to a replacement behavior test or a documented obsolete requirement. This prevents deleting coverage merely to make the suite green.
- Use isolated test databases and injected clocks; test state/results rather than implementation flags. Add event-order permutations, bounded generated correction/retry sequences, fault injection before/after writes, and independent real audio evaluation. A larger passing test count is not the success criterion.

## Why this is not another layer of the previous workflow

The existing browser tool handler, voice session and server pending-booking map each hold parts of action state. Merely relocating the same flags will not fix the behavior. The replacement must remove obsolete browser consent/draft flags and prompt requirements, not leave both architectures active.

The server is the sole owner of action data/revisions/results. Media delivery contributes events to that context, not independently maintained booking permissions. Gemini reports the meaning of a completed caller turn; a separate final transcript arriving late is not a word-matching gate for ordinary acceptance. An acceptance must still follow the relevant delivered offer and target the current revision. Incomplete delivery may need clarification, but a microphone interruption alone never resets the booking.

Before replacing the live adapter, test the domain workflow without Gemini and replay delayed transcripts, out-of-order events, interruptions and lost mutation responses. Then run the same conversations through Live. Removing exact phrase/output gates targets a known failure mechanism; it does not establish that recognition, semantic decisions, pronunciation or dialect will be error-free.

## Research sources and limits

- [Google Live tools](https://ai.google.dev/gemini-api/docs/live-api/tools): manual function-response handling and model-specific blocking/nonblocking support. Some examples use gemini-3.8-live while the support table names other Live variants; exact capability remains an integration test, not an inference from examples.
- [Google session management](https://ai.google.dev/gemini-api/docs/live-api/session-management): resumption, GoAway and context compression. Validate these against the exact model and ephemeral-token setup.
- [Google Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities): interruption cancels pending generation/tool requests; clients clear playback queues. Does not promise rollback of application side effects.
- [Google web console](https://github.com/google-gemini/live-api-web-console): reusable examples of streaming media and event logging. It is an experimental starter with older examples, not a ready appointment engine.
- [LiveKit workflows](https://docs.livekit.io/agents/logic/workflows/): start with one agent and tools; introduce workflow constructs only for concrete complexity. Borrow boundaries without adding its infrastructure.
- [LiveKit prompting](https://docs.livekit.io/agents/start/prompting/): short voice turns, structured instructions and behavioral testing. Not evidence of a guaranteed Saudi accent.
- [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests): retries reuse an operation identity and recover the prior result. Apply the pattern locally; do not add Stripe or copy all its retry semantics.
- [SQLite indexes](https://www.sqlite.org/lang_createindex.html) and [transactions](https://www.sqlite.org/lang_transaction.html): database-level occupancy constraints and atomic updates.
- [Retell simulation tests](https://docs.retellai.com/test/llm-simulation-testing): repeat scenarios, explicit success criteria and isolated external effects. We do not need Retell to build a local regression harness.

No external framework, plugin, calling service or calendar integration was installed. No live app prompt, database or voice behavior changed during this exploration.
