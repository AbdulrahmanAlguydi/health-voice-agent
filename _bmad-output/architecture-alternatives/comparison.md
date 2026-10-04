# Replacement architecture choice

Status: design recommendation, not implemented. Prepared using brainstorming and BMAD architecture, 2 October 2026. The user delegates selection; no runtime change is part of this comparison.

## Decision

Choose **one Gemini Live receptionist with resource-centered server functions**. Gemini controls the conversation; a small Express/SQLite application owns drafts, offers, contact capture, consent records and operation results. The server answers “what is known, missing or invalid?” rather than prescribing “say this sentence, then ask this question.”

This is a refinement of the previous server-owned action-context proposal, not a claim that an unrelated new framework solves the problem. The important change is refusing to turn that context into a second conversational controller. We keep the verified lost-result fixes as invariants and replace the old intake/delivery gates, rather than wrapping them.

Urban Hejazi Arabic is the chosen register, with English support and one configured voice. The architecture cannot guarantee the model always sounds Hejazi; listening tests decide that.

## Alternatives built out

| Design | Conversation owner | Application state | Main advantage | Main problem for us | Choice |
| --- | --- | --- | --- | --- | --- |
| A. Prompt-led, mostly stateless functions | Gemini | Persistent appointments; intake/approval primarily model memory | Fastest to assemble; flexible conversation | Corrections, phone chunks, duplicate/lost writes and reconnect depend heavily on model memory | Reject for expanded scope |
| B. Explicit server dialogue workflow | Server advances collect-doctor → time → contact → confirm stages; Gemini voices the next step | Persistent workflow state | Clear ordered processes, easy stage inspection | Recreates rigid ordering, repeated questions and coupling between audio completion and progress if implemented as our old gates | Reject as default |
| C. Resource-centered domain functions | Gemini | Small durable request/offer/contact/operation records, no mandatory conversational stages | Flexible order with deterministic business effects and recoverable results | Requires a carefully bounded consent/turn contract; cannot independently prove semantic understanding | Recommend |
| D. Streaming STT → text agent → TTS | Text agent | Can use the same domain API as C | Inspectable planned reply; independently selectable recognition and voice | New Arabic recognition/voice evaluation and synchronization; transcript errors still reach the agent | Conditional fallback |

These are qualitative engineering judgments, not benchmark scores. B could be implemented well, but its strongest benefit—strict ordered processes—is not our goal. D is a speech architecture, not a substitute for correct booking ownership; switching to it would still require C's domain integrity.

### A: why a better prompt alone is insufficient

Functions could expose search, book, move and cancel with excellent descriptions. The database would still validate occupancy. But model memory would hold the accepted slot, partial phone and target person. After disconnection, the application would need to reconstruct those facts; storing them plus idempotent results effectively leads back to C. A is attractive for a narrow disposable demo, not the requested management behaviors and observed recovery failures.

### B: what a server workflow would look like

A reducer/state machine would maintain a named conversation stage, permitted next events and stage-specific instructions. This is appropriate when the procedure itself must be ordered. It can support backtracking, but information detours, volunteered details, multi-person requests and bilingual corrections require transitions. We previously saw similar controller/gate interactions create loops. Moving identical flags to the server would relocate the problem rather than fix it. Do not use a generic workflow engine or per-phase agent handoff here.

### C: the selected implementation shape

Retain React/TypeScript, direct browser-to-Gemini media, Express and SQLite. Replace the booking adapter with a thin request transport and one typed server domain module per concern. Keep one active appointment request per session; complete one person's action before the next. A draft is an editable resource, not a conversation step. Its missing fields are facts, not mandatory next-question wording.

The important records are a small session envelope (immutable simulated calling metadata and active request), a draft (person, contact, doctor/service/target appointment), immutable offered choices, separate slot/action and contact acceptance, and operation/result records. Slot acceptance survives collection of a missing phone/name; changing doctor/time/person/action invalidates it. Revisions prevent stale writes without a yes-word whitelist or waiting for final captions.

The server owns the raw/canonical phone capture and digit count. Gemini interprets the correction the caller intended; deterministic helpers apply supported chunk/repetition/group forms. Ambiguous input gets a targeted repair without guessing, trimming or padding. Known calling metadata can be reused without dictation; it does not authenticate a person.

Offer issuance, presentation and acceptance are distinct. The adapter correlates output/input events; Gemini reports which offer it presented and which one the caller accepted. A generic yes cannot accept a known never-presented offer. Interrupted audio is not automatic rejection or a demand to replay the entire sentence. This is a bounded semantic contract, not proof that the caller heard or understood every detail.

Commit uses a server-issued operation ID bound to the validated action payload. That exact ID retrieves one durable result after timeout/reconnect. Domain services recheck capacity/time/rules at commit and enforce active occupancy atomically. Rescheduling retains appointment identity, cancellation releases capacity and retains history, and synthetic notifications are recorded in the same transaction. Simulated delivery is not real SMS.

Stop or an emergency closes admission to routine commits in the same serialized domain boundary. An already committed result remains retrievable; a delayed uncommitted request cannot cross the fence and revive the action. Emergency pauses existing details rather than deleting them; correcting a misheard emergency resumes with a new revision and fresh relevant acceptance. This does not undo a transaction that completed before the emergency was reported.

### D: when to reconsider the speech pipeline

A separate TTS voice may be worth testing if repeated actual listening trials show unacceptable Hejazi drift, number pronunciation or voice inconsistency after the domain replacement works. It enables control of the text sent to speech, but recognition and generated text can still be wrong. Do not claim a pipeline will improve Arabic without comparative Arabic audio trials. Do not add it now merely to solve a database or consent bug.

LiveKit's documented pipeline comparison makes the trade-off explicit: independently inspectable speech stages versus the expressive native-audio path. A half-cascade (native speech understanding plus separate TTS) is another conditional option, but requires verified text-output support from the chosen realtime provider and adds a voice dependency; it is not selected for our current Gemini setup. [LiveKit pipeline types](https://docs.livekit.io/agents/models/pipelines/).

## Transport/framework choice is a separate decision

Keep direct browser audio. A backend Gemini relay would make provider-event ordering easier to centralize, but adds another streaming connection and reconnect lifecycle. Google documents both approaches and says direct client streaming generally avoids the extra hop. This is support for the default, not a measured latency claim about our app. [Google Live overview](https://ai.google.dev/gemini-api/docs/live-api).

LiveKit could replace custom media lifecycle work while retaining Gemini or using a pipeline. It would not choose our booking semantics or remove probabilistic speech errors. Its own workflow guidance starts with a single agent and functions, then adds constructs for concrete limitations. No migration is justified yet. [LiveKit workflow guidance](https://docs.livekit.io/agents/logic/workflows/).

The Google-maintained experimental web console provides streaming microphone/playback and logging patterns to study, not a booking solution or a current starter to copy wholesale; its README includes older SDK/model examples. Reuse narrowly and check compatibility with our installed SDK. [Live API web console](https://github.com/google-gemini/live-api-web-console).

## What changes for the failures we observed

| Failure | Design response | Remaining limitation |
| --- | --- | --- |
| Repeated ID/intake questions | No mandatory patient-ID path or server-scripted stage; return known/missing fields | Gemini may still ask redundantly; score repeated live trials |
| Captions arrive late or mishear the caller | Captions are diagnostic text, not a word-matching booking gate | Semantic intent can still be misunderstood |
| Wrong yes applied to another time/person | Offer/subject/action revision and separate contact acceptance | Model-reported meaning is not independently verified |
| Three-digit phone breaks flow | Durable partial capture, exact count and repair, keep valid slot/name | Speech grouping can remain ambiguous |
| No voice or robotic lines | Native chunk playback without whole-turn withholding; no fixed ordinary replies | Provider generation/playback failures require recovery |
| Saved booking reported failed after timeout | Atomic operation result, reconcile same ID before another mutation | Temporary uncertainty until backend responds |
| Stop/reconnect loses or revives a draft | Domain state independent of transport; close serializes against pending writes | Reconnect still needs coherent provider context restoration |
| Doctor list feels slow | Versioned compact DB-derived directory preloaded; availability queried fresh | Native model/tool round-trip latency remains |

## Scope compatibility with the supplied prompt

Preserve its useful reception behavior: ask only missing details, accept one offered slot once, phone readback when dictated, corrections across turns, factual knowledge, unknown-answer acknowledgement, proxy/sequential family booking, lookup/move/cancel/waitlist/callback and clean ending. Use our own bilingual 30-doctor/10-specialty data, small service/policy catalogs and fictional Jeddah directions. Do not copy its records, preplayed greeting assumption, fixed ordinary lines, invented data residency, actual messaging claims or hardcoded clock.

Administrative department signposting uses stored synthetic mappings and at most two clarifications; no diagnosis or doctor ranking. Current emergency reports receive brief nearest-hospital emergency-department guidance; no fictional destination, clinical questionnaire or new routine write. Late cancellation is a stored synthetic policy with the exact 24-hour boundary, not a general healthcare rule. Summary links contain no clinical data and all external effects remain local simulations.

## Validation before replacing the working app

First back up current source (including untracked files), prompt and consistent SQLite data; use a separate replacement database. This comparison did not perform those backups or switch databases.

Build one guest-booking vertical slice before additional features: stable knowledge question → real offer → one acceptance → missing contact repair → one dictated-phone confirmation → exactly one appointment and simulated notification. Test the domain independently, then repeated Arabic/English Live text flows, then actual microphone/listening trials. Streaming audio tests cover queue cancellation, replay without tool execution, stale chunks and goodbye interrupted by a new question.

Migrate previous failures into outcome-based scenarios; retire tests only enforcing old ID/stage/phrase/playback gates. Assert rows, active capacity, revisions and results. Include changed-time acceptance, stale offers, delayed captions, duplicate/lost writes, restart/reconnect/Stop, phone correction and household targets. Expand to move/cancel and other simulated features only after that slice works. No unsupported error-rate estimate or claim that offline tests prove voice quality.

Provider probes are required before using asynchronous tools or session resumption with the exact configured model/token. Google's tool guide currently mixes model names in its capability matrix and examples; do not infer non-blocking support from a TypeScript enum. The synchronous function baseline remains workable. [Google Live tools](https://ai.google.dev/gemini-api/docs/live-api/tools), [session management](https://ai.google.dev/gemini-api/docs/live-api/session-management).

## Revisit conditions

Choose a server relay/framework only if measured provider ordering/media recovery defects cannot be managed by the thin direct adapter. Choose an STT/TTS trial if actual Hejazi voice evaluation fails. Choose a richer workflow only if the simplified domain model becomes insufficient for a demonstrated ordered process. No additional runtime model, framework or clinical integration is selected now.
