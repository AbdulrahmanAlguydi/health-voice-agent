# Architecture rethink

For the decisions actually taken and their rationale, see [Decisions and lessons learned](decision-log.md). The larger proposals below are research history, not approved implementation commitments.

Status: research reference. The broader backend workflow, framework integration, streaming adapter, audio recording and tracing proposals below are deferred. The approved prototype scope is direct Gemini, delivery-only audio buffering, a consolidated local booking context, media-safe draft recovery and structured browser diagnostics. See `health-voice-agent-design.md` and `superpowers/plans/2026-10-02-prototype-simplification.md` for the implemented scope.

## What we are optimizing for

This is a monitored prototype, not a real hospital integration. Preserve the Arabic-first, professional conversational Saudi tone and the single Gemini Live voice the user preferred. Support English, microphone input, text testing, persistent transcript bubbles, audio replay, doctor information and real changes to a synthetic SQLite booking database. No doctor recommendations or clinical advice. Do not ask for identity during information browsing. Guests supply only name and complete mobile after agreeing to a slot. Database facts take precedence over contradictory caller claims.

The decision is not simply speech-to-speech versus STT/TTS. It is where conversation, authoritative booking state, audio lifecycle and diagnostics belong, and what each can actually guarantee.

## Evidence from the existing implementation

1. The Saud lookup succeeded. A correct native reply used «اثنا عشر» and «خمسة»; the local checker rejected it. Replacing only the hour words with digits makes it pass.
2. A read-only diagnostic using identical output and two evidence contexts returned `changed_details` with availability evidence and `supported` with cached directory evidence. A follow-up with an incorrect verbal hour («أربعة مساءً» instead of the returned five) also passed directory evidence. Strict-sounding checks therefore provide neither consistent speech freedom nor comprehensive factual enforcement.
3. `session.ts` owns connection, input turns, tool batching, evidence, readback flags, playback completion, retry prompts and closing. `tools.ts` separately owns identity, availability, guest agreement and pending-booking flags. The server owns another pending-booking map and SQLite transactions. Facts and permissions have several owners.
4. An output rejection clears guest consent and can cancel an unheard pending readback. These are domain changes triggered by a media/check failure. An interrupted contact question can disturb appointment progress.
5. Automatic replay opens a new output gate without the previous availability evidence. It depends on the model calling the replay tool again; a direct repeat has a different checking context. A failed retry can display an old question rather than the failed lookup's current context.
6. Tool batches are allowed through special-case branches. Safe combinations such as cancel plus end can be rejected as invalid requests, leaving the model to try again. This is an orchestration concern, not invalid patient intent.
7. The player combines a complete generated turn before playback. Database reads can finish quickly while the user waits for generation/buffering. Removing a remote verifier did not remove that wait.
8. Diagnostics are capped at 500 string entries and omit rejected transcripts, full tool arguments/results, exact check inputs and detailed state transitions. They do not support deterministic event replay.
9. The connection handler treats unexpected closure as a restartable error and clears context. The inspected code does not configure session resumption or handle GoAway. Native session lifecycle is another independent failure class, not something a larger prompt fixes.

The observations above come from code inspection and local read-only probes; they are not claims that every intermittent microphone failure has the same cause. No production code or demo appointments were changed during this investigation.

## Options

| Approach | Strength | Cost / limitation | Position |
| --- | --- | --- | --- |
| Gemini Live with a smaller adapter and authoritative application workflow | Retains the tested native voice and flexible conversation; removes transcript-gate stalls | Spoken facts remain probabilistic; our transport and playback need focused tests | Recommended prototype direction |
| STT, structured text agent, then TTS | Can inspect the planned answer before speech and ground structured values before rendering | New recognition/voice evaluation, more components and potentially more latency; still not an absolute speech-accuracy guarantee | Fallback if spoken control outweighs preserving native voice |
| Gemini Live through LiveKit or Pipecat | Reuses voice lifecycle, events and observability abstractions | Framework/server integration, deployment/runtime work; does not solve our booking semantics or guarantee facts | Consider a bounded spike, not an immediate migration |

Do not continue extending word/phrase allowlists as the central architecture. Do not reintroduce a second semantic verifier by default: the user rejected its latency and extra failure dependency. Do not add external search, real telephony, multi-agent handoffs or a real hospital database.

Google documents manual function-response handling for Live. Its session guidance covers resumption, compression and connection lifecycle. LiveKit documents separate realtime turn handling and observability. Pipecat organizes transport/model/audio work into frame processors. These are useful patterns, not evidence that migrating frameworks will automatically fix our app. Exact asynchronous-tool support must be verified against the configured model; do not infer it from another model's examples.

Sources: [Google tools](https://ai.google.dev/gemini-api/docs/live-api/tools), [Google session management](https://ai.google.dev/gemini-api/docs/live-api/session-management), [LiveKit turns](https://docs.livekit.io/agents/logic/turns/), [LiveKit observability](https://docs.livekit.io/testing/observability/), [Pipecat pipeline](https://docs.pipecat.ai/pipecat/learn/pipeline).

Framework compatibility is a remaining validation task, not an assumed result. [LiveKit's Gemini plugin](https://docs.livekit.io/agents/models/realtime/plugins/gemini/) exposes configurable model/voice parameters in Python and Node.js, but its compatibility notes do not establish that every feature works with our exact `gemini-3.8-live` setup. [Pipecat's Gemini Live integration](https://docs.pipecat.ai/api-reference/server/services/s2s/gemini-live) is another concrete implementation to evaluate. No framework was installed or connected during this research. A framework spike should prove the same model/voice, function calls, text tests, interruption and local traces before it earns a migration recommendation. Managed framework observability may require its cloud infrastructure; do not mistake that for free local logging.

## Proposed responsibilities

### 1. Gemini handles conversation, not transaction authority

Give Gemini a concise persona, conversational objectives, tool conditions and grounding guidance. Return localized doctor facts, actual slot IDs/timestamps, app-computed Gregorian/Hijri/relative labels, missing fields and useful validation errors. It chooses natural wording, asks focused repairs and acknowledges corrections. A question about an absent doctor qualification gets «ما عندي هالمعلومة», not an unrelated scope refusal.

Remove scaffolding whose main purpose is selecting a line to recite. Normal greetings, contact questions and acknowledgements should not require `speak_safe_reply`. A replay request is a presentation/context action, never a rerun of a write. Keep external knowledge/search unavailable.

Browsing must remain flexible: callers can ask questions, change specialties, hesitate or leave at any point. The workflow constrains actions that change booking state; it must not become a rigid conversation script.

### 2. The backend owns one versioned booking context

Store selected doctor/slot, identity or guest details, missing fields, draft revision, pending confirmation and committed result in one authoritative session context. The UI and voice adapter consume snapshots rather than maintain competing copies of domain flags. Temporary contact data is not a persisted guest profile; guest/profile appointment persistence still happens atomically at commit.

A candidate workflow is browsing, slot selected, collecting details, draft ready, awaiting final consent, committed, cancelled. These are permissions and data states, not mandatory sentences. A caller can move back to browsing without losing unrelated valid details. Changing doctor/slot/contact information invalidates final consent for the previous revision; a microphone interruption alone does not erase those fields.

Functions validate schema, identifiers, availability and current revision. Updates to a draft are explicit. Each action returns structured `status`, `contextRevision`, `missingFields`, field errors and `nextAction`; it does not return a supposedly universal recovery sentence. Read-only queries are allowed without patient identity. Identity and guest collection follow the agreed flow, including details volunteered by the caller rather than repeatedly requesting them.

### 3. Consent is separate from fluent speech

The model saying “confirmed” does not authorize a write. Confirmation must refer to the current draft revision and follow its final summary. The current initiating request cannot also authorize its later readback. Finalized caller input must be fresh; ambiguity, a changed detail or “yes, but…” triggers clarification/update, not a commit. A tool call arriving before the final input transcript can wait for that evidence without resetting the conversation.

Playback completion remains relevant to whether a confirmation question finished, but it records a delivery event for a particular response/revision. It must not be the owner of doctor facts or appointment data. An interrupted final summary requires completing/repeating that summary before fresh final consent; it does not delete the draft.

Native generated speech cannot be proven to match the draft merely because its audio finished. The web UI should show the canonical pending summary alongside natural speech. This improves observability but is not a replacement for informed spoken confirmation. That residual risk must stay explicit in the prototype acceptance criteria.

Commit rechecks the real slot and writes the guest/profile appointment in one transaction. Give commits an idempotency/action ID and a result lookup: if the response is lost after a successful write, recover the existing result, not a second appointment or a guessed success. Cancellation and ending cannot roll back an already committed appointment unless an explicit supported operation exists.

### 4. Voice transport owns media and provider lifecycle only

Use an adapter around the Google SDK to normalize events and correlate connection epochs, input turns, output responses and function-call IDs. Ignore late results for superseded turns without silently losing a valid server commit. Process mutations in order. Multiple read calls may run concurrently; dependent cancel/end or correction operations must be explicitly sequenced rather than rejected as arbitrary mixed batches.

Stream output into a small playback queue when audio arrives instead of buffering an entire turn for wording approval. Retain a copy for bubble replay. Distinguish generated, queued, started, completed and interrupted audio. Stop queued playback promptly on genuine provider interruption. Local VAD onset is a hint for input tracking; it should not independently clear booking context.

Handle provider closure/GoAway, resumption when supported by our token setup, missing audio and playback/device errors as separate cases. Recovery is bounded and stage-aware. Reconnecting can preserve application context even when provider conversation resumption is unavailable. Neither reconnecting nor repeating speech automatically retries a database mutation.

The adapter should expose an interface that could later run through a framework; do not introduce LiveKit rooms or a Pipecat service merely to rename the current tangled controller.

### 5. Logs capture an inspectable event timeline

Record every observable event needed to explain decisions, with schema version, session ID, connection epoch, input-turn/output-response IDs, tool-call/action IDs, draft revision, timestamp and local duration measurements. Record input/interim/final transcripts, assistant transcript deltas/final text (including rejected or unplayed responses), tool arguments/results, HTTP status/duration, state before/after, validation and consent decisions, media chunk counts/duration, playback lifecycle, errors, cancellation and recovery attempts. Include model/voice, prompt/config version and relevant calendar clock/timezone so a trace can be reproduced.

Persist structured events locally through a bounded/rotated file-backed collector, with a browser queue while offline and a JSON export. Preserve the compact readable panel as a view of that data, not its only storage. Session logs and runtime/server failures belong to the same correlated trace. Collection failures must be visible but must not stop the conversation. Exclude API keys, ephemeral/resumption tokens and audio base64 from routine events.

For recognition or pronunciation problems, transcripts are insufficient evidence. Offer a deliberate local audio-recording mode for synthetic test sessions, with microphone and agent audio linked to turns, including interrupted/failed output where available. Keep it separate from normal structured logging; do not silently turn on recording. Provider-hidden reasoning/internal audio processing is not observable and cannot be logged.

### 6. Tests exercise sequences, not just phrases

Use captured sanitized event traces to replay the controller without provider calls, with injected clocks/network results. Test delayed input transcripts, fragmented transcripts, duplicate tool requests, stale replies, interruption during contact repair/final summary, harmless tool batches, network failure after commit, reconnects and closing after playback.

Test domain invariants independently: no commit without a current draft and fresh final consent; no consent carryover after a correction; no duplicate appointment for a retried action; no guest profile on abandonment; no available slot accepted merely because the caller claims it exists. Read-only replay cannot write.

Run varied Arabic and English live dialogue separately from deterministic tests. Include number words, ordinal dates, unknown facts, absent doctors, unavailable hours, uncertainty and language switching. Measure tool duration, first output audio, first playback and overall turn latency separately. Listening/microphone tests are required for pronunciation, pacing, ASR and barge-in; typed tests alone cannot establish those qualities.

## Boundaries and rollout

The booking/database action guarantees are enforceable in application code. Universal factual correctness of native spoken output is not. The user accepted that distinction, but removing phrase gates must not be described as replacing them with a perfect intent checker.

Keep the current app usable while first adding correlated diagnostics. Next establish/replay the existing failure traces, implement the authoritative workflow independently of voice, then connect a small Live adapter and streaming player. Remove obsolete checks/retry branches only as their responsibilities are replaced. Preserve existing SQLite bookings and synthetic accounts; no database reset is part of the redesign. Update the main design document only after the replacement is approved.

Before committing to a full rewrite or framework migration, use one bounded vertical experiment: doctor query, slot selection, guest details with `123` repair, final readback, cancellation and interruption. Evaluate Arabic audio, state preservation, correct zero writes after cancellation and trace completeness. If native spoken grounding proves unacceptable, reconsider the controlled text/TTS option using the same backend workflow; do not rebuild the database again.

This is a proposal for discussion, not an implementation plan or a claim that the described tests/features already exist.
