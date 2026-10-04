# Decisions and lessons learned

This is the rationale/history companion to [the main design](health-voice-agent-design.md). The main design describes what the prototype currently does; this file explains why. [Architecture research](architecture-rethink.md) preserves the broader alternatives, including proposals we did not implement. Dated plans contain implementation and test evidence.

## Semantic booking actions — 2 October 2026

### BMAD architecture audit and recovery

The subsequent architecture-selection run compared mostly stateless prompt-led functions, a server dialogue workflow, resource-centered domain functions and a streaming STT/agent/TTS alternative. Recommended resource-centered drafts/offers/operations with Gemini still owning conversational wording/order; this refines the prior action-context proposal instead of installing a second dialogue controller. Urban Hejazi Arabic is the selected register. Direct audio, one Live model and the current web/server stack remain the recommendation; relay/framework/TTS alternatives require a measured reason. See `_bmad-output/architecture-alternatives/comparison.md` for trade-offs and primary sources. This is design selection only, not an implemented replacement or proof of improved voice.

Adopted BMAD's architecture/build/project-context path proportionally: a short architecture spine with independent rubric, reality and seam reviews, focused fixes, and root `AGENTS.md` rather than another full planning workflow. The expanded replacement remains planned; this audit does not claim it has been implemented.

Reproduced a saved appointment becoming unrecoverable after its HTTP response was lost. Added durable results keyed by pending ID in the same transaction as appointment/slot/guest writes. The browser retains unknown outcomes and retries the originally approved operation instead of creating another booking. A test also forces result persistence to fail and verifies all related writes roll back.

Transport disconnection previously cancelled the draft and greeted again. Reconnect now retains local intake/draft/result state and supplies structured context; explicit stop reconciles unknown commits and waits for in-flight preparation before cancelling. Review caught early-intake resume omissions and the delayed-response/stop race; both were corrected with targeted coverage. Uncommitted server drafts remain in memory and page reload recovery is not promised.

BMAD setup's Windows `WinError 5` was a directory-rename failure while Vite watched the project, not a general privilege failure: ordinary restricted-mode rename probes passed, setup repeatedly failed with Vite running, then succeeded with Vite stopped. Vite now ignores BMAD runtime/staging/output. Official setup reports current while the restored dev server runs; that no-change run does not exercise another replacement rename, so exclusion is a preventive fix rather than proof every future watcher conflict is impossible.

Verification details live in `_bmad-output/plan-booking-result-recovery.md` and the architecture review reports. These offline correctness tests do not verify voice naturalness or actual microphone recognition.

### Follow-up: availability wording and chat scrolling

Read-only verification found booking HA-FCB79B in the persistent database with Dr Nada Al-Khatib, Sunday 4 October at 17:00 Riyadh, and its slot marked booked. Checking it did not modify or duplicate it. The preceding «لقيت لك موعد ... أحجزه لك؟» described an available slot, not a saved booking, but sounded unnecessarily like a new search. Updated the registered-draft fallback to availability wording and added that conversational intention to the Live prompt; no sentence enforcement or extra model. Transcript scrolling now targets the log container directly after message/partial-text changes, with immediate movement rather than repeatedly restarted smooth animations. Regression tests preserve previous messages and keyboard focus while following both speaker roles and interim input.

Verification: 473 automated tests / 41 files and build passed. A fresh Arabic typed Live session used «الموعد متاح ... أحجزه لك؟» before approval, then «حجزت لك موعد...» after saving exactly one disposable test appointment. No scenario failures were reported. The scroll tests supply layout measurements in jsdom; the Live test generates native audio but simulates playback completion. Neither is a microphone/pronunciation assessment.

The latest failed microphone session recognized «اي، هذا ملفي» and «اي، هذا الملف حقي», but the application's ownership phrase matcher rejected them. Gemini understood ownership and moved on conversationally while the application still awaited it. A later “حجزنا ... هل تأكد الموعد؟” was not proof of a database booking: no draft or commit existed. Growing the phrase list would leave the same split interpretation.

Gemini now reports ownership through confirm_patient_identity (own_record/not_mine/unclear) and final consent through confirm_booking (approve/decline/change/unclear). The application no longer parses those decisions from caption vocabulary. It still owns found-record and delivery prerequisites, fresh completed turns, pending drafts and a completed-booking receipt; the server owns expiry, availability recheck and atomic writes. Unclear replies retain valid progress. Missing decisions cannot save. The functions expose bookingStage and allowedNextActions, making pending versus saved explicit without introducing another framework/model or prerecorded speech.

Actual Live tests nevertheless produced a premature “حجزنا” claim even with correct pending status. Added a narrow local booking-status wording check, not a general sentence verifier: one native regeneration from authoritative status, no automatic write. A failing controller regression revealed that this repair discarded the pending summary's delivery ID; preserving that delivery obligation allows the corrected summary and a later fresh approval to complete. Another failing test removed a false positive for «أكيد، تم الحجز» after saving. These heuristics do not catch every possible misleading sentence.

Testing also exposed an independent lookup failure: Gemini transliterated «ندى الخطيب» as “Nada Al Khateeb”, an unsupported alias. Kept exact database matching rather than fuzzy substitution. A one-per-turn original-name retry hint returns the caller's actual text; the first forced real Live test showed Gemini can ignore that hint and ask for clarification instead. Preserve that failed report. A fresh forced run did retry in Arabic automatically, retrieved the correct doctor, and completed one booking. The harness can answer a clarification when needed, but that branch was not used in the successful run; automatic recovery is not guaranteed. A malformed identity-function call without a found record now returns invalid_patient rather than a name-confirmation question with an undefined name.

Typed Live tests exercise the real model, function calls, native audio generation and disposable SQLite writes. PCM playback completion is simulated: they do not evaluate a microphone, accent, pronunciation or actual listening. Explicit semantic decisions still trust Gemini's interpretation. In one ambiguity replay it treated «اي هذا ما في» as ownership and later «اي هذا» as appointment assent; no app phrase matcher can now independently certify those meanings. Clear uncertainty (“not sure whether this is my or my brother's profile”) and explicit rejection are separately tested for zero writes. A guest Arabic run used «كضيف» despite guidance; one English generated caption included an unexplained trailing marker. These are recorded model-output limitations, not a guarantee of flawless speech from green tests.

Append or mark decisions superseded when our direction changes. Do not overwrite the reason for an older choice, or treat a historical test result as proof of the current version.

## Booking failure follow-up — 2 October 2026

**Observed in the user's microphone session:** Gemini called `confirm_guest_slot` without ever choosing the registered or guest path. The caller's “اي، احجز لي هنا” failed the local first-stage consent matcher. Guest contact questions were allowed because the guard only ran when the guest-path flag was already true. `prepare_guest_booking` therefore repeatedly returned `awaiting_guest_consent`, not `pending`; the model presented it like a final summary and called `confirm_booking` with no draft. These were application/tool-contract gaps, not a slow database or failed reservation SQL query.

**Decision:** Retain natural, unchecked speech and direct Gemini. Make guest-only functions redirect an unresolved caller to the existing patient-ID choice, and return explicit next steps distinguishing initial slot consent from a prepared final summary. Broaden ordinary Arabic/English consent, but keep corrections and fresh final consent checks. Identification must preserve already offered times; preparation and commit still revalidate availability on the server.

**Contact-data lesson:** The model passed 1234567 after incomplete digits. Instructions alone did not prevent padding. The model-facing mobile schema now accepts incomplete input so the function can explain the repair; server validation still requires 7–15 digits. During guest intake, observed numeric contact digits are retained locally and checked against preparation arguments. A mismatch asks for the complete number without discarding doctor, slot, name or agreement. This is a targeted action-data check, not a speech filter. It is not a general solution for every transcription error or every spoken-number representation.

**Testing lesson:** Earlier Live tests mainly used callers who volunteered that they lacked an ID and cancelled before saving. They did not prove the ordinary ID-choice path or a completed booking. New regression tests exercise real Express routes and disposable SQLite for Arabic/English registered and guest commits. `scripts/smoke-completed-booking.ts` also exercises the actual Live model with synthetic text input and native PCM output; writes go only to an in-memory database. Separate final consent is still required when an earlier yes merely advances initial consent.

**Additional findings from Live tests:** “Yes, please book that time” needed a missing consent filler. One Arabic response prematurely said the appointment was booked during ID intake; another used an unclear term for the patient ID. One English contact repair switched to Arabic. Clarified selection-versus-booking semantics, the patient-ID field name, and language continuity in the prompt/objectives. These remain probabilistic speech behaviors, not new runtime sentence gates.

**Voice:** The recording and session already used the same Fenrir voice. Only the opening is prerecorded; later replies are generated live. Regenerated the opening with the current Arabic delivery prompt and added continuity guidance across facts, dates, numbers and repairs. This does not prove identical prosody or human naturalness; microphone and listening tests remain necessary. Rerecording many booking “lines” would undermine the conversational design and would not repair the transaction bug.

**Final verification:** 413 offline tests and the production build passed. Actual Live runs completed one appointment each in Arabic guest, English guest and Arabic registered scenarios, all with Fenrir and all against disposable memory. The final Arabic guest run clearly asked “هل عندك رقم مريض؟” after the time was chosen. Test transcripts and exact scope are in `docs/superpowers/completed-booking-*.json`; the focused plan is `docs/superpowers/plans/2026-10-02-booking-recovery.md`.

### Follow-up: replay the user's actual number-correction sequence

The user clarified that “Nincs több” was a mistranscription of the dental-section request. The original structured log already showed a successful Dentistry lookup at that turn: Gemini's audio understanding and its displayed ASR text were not identical. Do not hardcode that foreign string as an alias for Dentistry.

Added `--last-transcript` to the actual Live test. It follows the saved caller sequence, substituting only an Arabic equivalent of the clarified dental intent and marking inserted answers to the new ID-choice step. Ambiguous ASR name fragments remain visible rather than silently being relabeled as exact patient speech. The replay restores the original two offered appointment options in disposable SQLite, so the 5 PM selection remains meaningful. It verifies the final eight-digit number `12345678`, not the different ten-digit number from the simpler smoke test.

The first replay did not invent a complete number and eventually booked the correct eight-digit contact, but ignored the request to read the incomplete number back. It also needed an extra initial-consent/final-summary round. One test falsely matched “ليتم الحجز” as “تم الحجز”; fixed the test's word boundary instead of treating a future-purpose phrase as a completed booking claim.

Phone evidence was previously collected only after initial slot consent and only from written digits. Expanded collection to guest intake and added bounded Arabic/English digit-by-digit normalization, including the actual “واحد اثنين ثلاثة” correction. Preparation rejects invented digits even when the model skipped the initial-consent function. Speech guidance now answers a partial-number readback before asking for completion, and distinguishes heard details from records already saved. No global speech filter was added.

A typed replay exercises conversational handling and function arguments, not the original microphone signal or recognition accuracy. The original caller audio is not retained, so this test cannot prove that “قسم الأسنان” will now transcribe correctly when spoken by the user.

Final replay: 19 caller turns (17 logged/corrected-intent turns plus two explicitly inserted answers). It read the partial number back as ١٣٣, acknowledged the caller's digit-word correction as ١٢٣, then prepared and saved exactly 12345678 after a fresh final confirmation. The phone and booking scenario checks passed, and 416 offline tests plus the production build passed. [Readable transcript](superpowers/last-transcript-replay.md) and its JSON diagnostics preserve the evidence. Remaining findings: the ambiguous name fragment became بدر وغادة, and one output caption included a stray “tienes”. The test is not a declaration that all language/name/voice behavior is correct.

## Context

The priority is a natural Arabic-first, bilingual voice receptionist, using fictional doctor/patient data and persistent demo bookings. The user preferred Gemini's live voice in AI Studio. The prototype supports doctor questions and patient-selected appointments, not doctor recommendations or clinical advice. It is monitored; real telephony and hospital integration are out of scope.

## Decision record — 2 October 2026

### 1. Keep Gemini Live directly; do not migrate frameworks

**Decision:** Keep the existing browser-to-Gemini Live connection and Express/SQLite functions. Do not introduce LiveKit or Pipecat for this prototype.

**Why:** The observed failures involved our output checks, delivery/booking coupling and diagnostics. A framework would not automatically correct those application decisions or improve the Arabic voice. It would add integration/runtime work before proving a benefit for the current demo.

**Alternatives:** LiveKit/Pipecat remain options if telephony, concurrency, provider switching or transport maintenance becomes a real requirement. Exact compatibility with our configured model/voice was not proven, and no framework was installed.

**Revisit when:** Measured transport/lifecycle problems—not merely a disappointing reply—justify the additional infrastructure.

### 2. Retain native speech-to-speech for now

**Decision:** Keep one Gemini Live conversation/voice model with application functions, rather than replace it with STT → text agent → TTS.

**Why:** Preserving the voice experience the user liked is central to this prototype. A chained pipeline would require a new Arabic recognition and voice evaluation. It offers more control over the planned text but is not automatically more natural, faster, or perfectly accurate.

**Tradeoff:** Native spoken facts are probabilistic. Completing playback cannot prove that the model spoke every draft detail correctly.

**Revisit when:** Repeated listening tests show unacceptable Arabic quality, or controlled spoken factual rendering becomes more important than preserving the live voice. The existing database/functions need not be rebuilt for that experiment.

### 3. Remove sentence-checking from normal playback

**Observed:** The Saud availability lookup succeeded. Correct Arabic «اثنا عشر الظهر» and «خمسة مساءً» were rejected against numeric labels. Substituting digits made the reply pass. The same words passed under a different cached evidence context; an incorrect verbal hour could also pass that context.

**Earlier approach:** A second semantic model was introduced to tolerate paraphrases after lexical checking proved restrictive. It added roughly 1–6 seconds in earlier tests and another quota/provider failure dependency. We then tried local factual checks to avoid that network request. Local checks were faster but still rejected equivalent language and missed some incorrect facts.

**Decision:** Production sessions now buffer media without matching the transcript to prescribed sentences, names, numbers or date labels. No second verifier runs. Legacy checkers are explicitly injectable for diagnostics/tests only.

**Why:** Expanding phrase/number/date allowlists repeatedly patched symptoms. The checks did not provide the comprehensive factual assurance their strict behavior suggested, and withholding valid audio harmed the main voice experience.

**Tradeoff:** This is not a replacement “perfect intent checker.” Unsupported or inaccurate speech may be played. Grounding, bilingual behavior, scope and complete summaries remain prompt requirements and conversational test targets. Action safeguards remain in functions.

### 4. Enforce database actions independently of wording

**Decision:** Retain schema/identifier validation, patient self-identification, guest-slot agreement, final-summary delivery, fresh final consent and transactional availability rechecks. The model cannot execute SQL or bypass the supported booking functions.

**Why:** A fluent sentence saying “confirmed” is not evidence of a database write. A caller's claimed availability is not an available database slot. An earlier yes, hesitation, or “yes, but another time” must not authorize the current draft.

**Boundary:** These checks constrain the implemented booking flow; they do not guarantee all spoken claims are correct or make the prototype suitable for real patients.

### 5. Separate booking progress from audio delivery

**Observed:** Failed output checks or interrupted contact questions could clear guest agreement or cancel an unheard draft. This forced the conversation backwards even when the chosen appointment and valid details had not changed.

**Decision:** Consolidate local booking fields in the tool handler and keep delivery flags in the session. Retain an uncommitted draft and existing guest agreement through media interruptions/failures. Repeat the complete pending summary before accepting fresh final consent. Ignore stale playback-completion callbacks after interruption or disconnect.

**Why:** Not hearing a sentence is different from changing or cancelling an appointment. We need to invalidate delivery/consent without throwing away valid progress.

**Limits:** Explicit correction/cancellation still invalidates the old choice. This was a focused local simplification, not the proposed versioned backend workflow. Unexpected provider disconnects still require a restart; automatic resumption and lost-commit-response reconciliation were not implemented.

### 6. Make replay read-only and handle safe closing sequences

**Decision:** Pending-summary replay returns the existing draft; it does not prepare again or confirm a booking. Other replay uses the latest read-only lookup or played conversational response. Allow ordered cancel → end and cancel → availability repair batches; retain restrictions on dependent preparation/confirmation/identity batches.

**Why:** “Say that again” is a presentation request, not permission to write. Gemini can naturally issue cancellation and closing together; rejecting that safe sequence caused unnecessary recovery.

**Evidence:** The latest Arabic Live replay returned the same pending summary without a second preparation. Arabic and English Live flows handled cancel + end and closed after their goodbye audio.

### 7. Measure the delay before optimizing the database

**Observed:** Earlier warm doctor queries measured approximately 3–6 ms and slot queries 5–8 ms. One saved conversation had about seven seconds between a returned doctor result and output beginning. That interval included generation/buffering and the then-active remote check; those logs could not attribute every component separately.

**Decision:** Add structured browser diagnostics: session/turn correlation, tool arguments/results, HTTP/tool duration, first-output-audio timing, booking snapshots, generated/unplayed text and playback/recovery events. Keep the existing database; do not add a cache merely because a lookup conversation felt slow.

**Why:** The patient experiences the entire turn, not just the SQLite query. Missing rejected text and state transitions made us infer causes from incomplete evidence. Text recognition, tool validation, model generation, output checks and playback are different failure stages.

**Limits:** Browser logs retain the latest 500 events; details exceeding 64 KB are explicitly truncated. Credentials and raw audio are excluded. Storage/collector failures cannot stop conversation. This is not a persistent server trace collector or deterministic event-replay system. Complete generated turns still buffer before playback, so generation/buffering latency remains.

### 8. Prefer conversational goals and actionable errors over scripts

**Decision:** Routine intake uses conversational objectives, not mandatory lines. Be direct and professional in Saudi Arabic without unnecessary honorifics. Ask only for a full name, not a required three-/four-part name. Missing doctor information should get “ما عندي هالمعلومة,” not a guessed fact or unrelated refusal. An incomplete mobile number should trigger repair of that field, keeping the chosen appointment and valid name.

**Why:** Reading fixed wording made the agent sound scripted. Function descriptions and field-specific validation tell the model what it needs to recover, instead of adding a sentence for every possible error. Speech transcripts are imperfect evidence of what the caller meant; context and focused clarification matter.

**Evidence/limit:** Live tests repaired mobile input `123` into a complete caller-provided number in both languages. Arabic still produced awkward/formal phrases in some turns. Removing checks and adjusting instructions do not establish human-like pronunciation, pacing or naturalness.

## What the verification actually established

For the simplification implementation, 403 offline tests across 37 files and the production build passed. Three actual Gemini Live typed-input flows covered 26 caller turns: Arabic guest repair, English missing doctor information/guest repair, and Arabic Saud availability/guest repair/pending-summary replay. They generated audio, used zero verifier requests, cancelled rather than committed bookings, and ended after closing playback.

Offline regressions covered Arabic spoken hour words, English paraphrases, interrupted/failed final summaries, blocked premature confirmation, stale playback after disconnect, retained guest agreement, structured log persistence/export and a throwing diagnostic collector. See [the implementation plan and verification record](superpowers/plans/2026-10-02-prototype-simplification.md).

Those Live tests simulated playback completion from PCM duration. They did not establish microphone recognition, pronunciation, perceived Saudi tone, actual device failure handling or universal factual accuracy. Test counts are historical evidence for that implementation, not an evergreen assertion about every future edit.

## Working lessons for the next change

### 2026-10-02: All speech live, including the opening

The user approved trying a live-generated opening for continuity with later replies and then explicitly removed the suggested recording fallback. Removed the opening clip, loader, generator script and recorded-output path. The short Arabic opening keeps the clinic name and help-question intent but may vary naturally. It uses the configured Live voice and current prompt; no second speech model or wording verifier was added. Failed opening media now uses ordinary bounded Live recovery, not another recorded line. This trades immediate/predictable startup for generation latency and variation. It does not solve microphone recognition or guarantee human-like voice delivery.

Regression tests exercise live output before playback and missing-audio recovery with no recording. A real read-only Live smoke generated an Arabic clinic greeting with native audio; playback completion was simulated, not perceptually evaluated. No database records were changed by greeting tests.

### 2026-10-02: Ordinary identity agreement exposed a testing gap

Session 62211311-f410-434a-9f27-b3f4a3bbe09a repeatedly looked up patient 123. The caller's completed captions «اي صحيح» and «نعم، صحيح» were followed by invalid_patient from prepare_booking, not a database error. The identity parser accepted standalone assent and explicit ownership phrases but rejected combinations of ordinary assent words; a rejected answer consumed the pending verification. Earlier booking tests used explicit «إيه هذا ملفي» and missed this path. More green tests were not a substitute for representative replies and microphone event ordering.

Accept bounded combinations of identity assent words in Arabic and English, retaining denial, conflicting-name and relationship checks. Do not reuse the broader booking-consent grammar: agreeing to book does not identify the caller. Regressions reproduce both actual Arabic replies and a prepare call arriving before final microphone transcription, through the real tool handler and disposable database. Actual Live typed Arabic «نعم، صحيح» and English “Yes, correct” each completed one registered booking without another ID request. These runs generate audio but simulate playback; they do not evaluate microphone recognition or pronunciation.

Reinforced consistent Saudi delivery within and between replies, with professional reception questions rather than «وش في بالك اليوم؟». Doctor names are full on first introduction and final confirmation, otherwise first-name references are appropriate when unambiguous. Local directory checks now admit unique first-name references; final readback name checks remain full-name checks. Fixed the Arabic protected-name pattern to handle the period in «د.». Keep the same Fenrir voice and live speech, without recordings or an added model. Prompt guidance cannot guarantee zero accent drift; listening feedback remains necessary. Fresh verification: 437 tests across 38 files and production build passed.

### 2026-10-02: Repair identity at the missing step, not from the beginning

The next microphone session showed «اي هذا» and the uncertain caption «اي هذا ما في» followed by invalid_patient and another ID request. The prior fix expanded ordinary assent but left the architectural recovery flaw: any unrecognized ownership reply discarded a successfully looked-up record. Caption quality cannot be fixed with an ever-growing list of exact accepted sentences.

Now keep a delivered, pending profile after an unclear reply and return needs_identity_confirmation with the existing name and explicit next-step context. Clear contradictions (denial, another name or a relative's record) still invalidate it; unclear captions never authorize preparation. Short contextual references such as «اي هذا» can confirm the just-read record. Added identity_confirmation diagnostics to distinguish recognized assent, clarification and rejection/undelivered readbacks. Repeating a reply prioritizes the pending patient-name question as well as pending appointment summaries; the first English Live recovery test exposed that replay previously returned “which reply?” instead.

Tests cover repeated unclear Arabic/English microphone captions, no appointment write while uncertain, reuse of the same found ID, replay, and a fresh clear answer proceeding to preparation. The full session controller is exercised, not just the phrase parser. The first Arabic Live recovery run failed before reaching identity because its doctor lookup returned not_found; this is a separate model/tool-argument failure, not evidence that the identity regression passed. Live typed tests simulate audio completion and cannot validate microphone recognition.

After the replay fix, actual Arabic and English Live runs each retained one found profile across two unclear/repeat turns and committed exactly one appointment after fresh final consent. The smoke's lookup counter initially falsely flagged begin_booking→found (it counted only lookup_patient); corrected it to count both successful lookup entry points. These runs are not pristine: the Arabic output caption included an English “thought”/planning passage during one repair turn. This was observed, not treated as spoken-audio quality verified or fixed. Fresh automated verification: 444 tests / 38 files and build passed. The recovery change resolves the reproduced state-reset path, not every possible Live-model failure.

### 2026-10-02: One final confirmation, not a guest-consent loop

Session a59d3265-a690-4384-b09e-a46c156bfb77 showed two causes: an unclear preliminary affirmative caption prevented guest preparation, though Gemini proceeded with intake and a final-looking summary; later actual preparation succeeded but microphone replies interrupted audio, keeping readbackComplete false and causing repeated summaries. No commit succeeded in that session.

Removed the preliminary guest-consent prerequisite. After choosing a time and requesting booking, resolve existing ID versus no ID, collect valid contacts, prepare an uncommitted draft, present one final summary, and require one fresh clear confirmation. Repeated Arabic affirmative words such as «إي إي صحيح» are recognized without allowing changed appointment details. In the web prototype, displaying a complete buffered summary enables confirmation while audio plays. Added separate presentation evidence/diagnostics rather than claiming audio was fully heard. Withheld outputs cannot set presentation; non-presenting clients still require completed playback. Production calling would need a different delivery/consent policy.

The preliminary confirm_guest_slot function is no longer exposed to Gemini, so the normal tool menu cannot lead back to the extra question. Its legacy handler remains only for older diagnostic fixtures. Arabic guidance avoids «كضيف» and uses recipient-directed service phrases such as «نحجز لك» or «نشوف لك» conversationally, not as mandatory recorded lines. Text tests cannot establish pronunciation improvements.

Regressions cover Arabic/English preparation without preliminary assent, no write before summary presentation, fresh confirmation after presentation, and microphone confirmation during interrupted audio. Actual Live Arabic and English guest booking tests each committed exactly one test appointment with zero reported scenario failures; no extra initial consent was requested by the agent. Tests use disposable databases and generated audio, not the user's microphone or persistent demo records. The first Arabic fixture still supplied an obsolete initial yes after the agent asked for the name; removed that scripted turn and reran the updated fixture. The updated Arabic run nevertheless said «حجزنا لموعد يوم الأحد» before preparation: an inaccurate early spoken claim missed by the script's narrow phrase matcher, not an early database write. Zero reported test failures does not imply perfect conversation. Automated counts/build results and this limitation are recorded in the implementation plan.

### 2026-10-02: Attention greetings and uncertain gender captions

Latest observed session 91af8ae6-7edc-43e8-b540-1d6986fee305 returned Dr. Saud's availability successfully in 118 ms. A subsequent incomplete output “معاك إذا تحب” hit the output delivery timeout and appeared without voice. The app then captioned two microphone utterances as “Hello.”; the user clarified these were Arabic «ألو». Gemini replied in English with fresh greetings and later asked which doctor again. The application still retained the doctor and offered slots; no booking write was attempted. These events do not establish why the upstream output failed to finish. No claim that the timeout itself is fixed.

The local detector previously treated hello as a strong English cue. The prompt also included an unconditional English Hello example. Removed that conflicting example, kept ambiguous standalone greetings in the current language locally, and added Arabic/English contextual guidance: an attention check should continue the existing appointment question, not restart reception. Prefer neutral questions rather than assigning gender from an uncertain «حابه» caption. No extra model, voice change, caption rewriting, or new speech blocker.

Verification: two added regressions failed before the local change and passed afterward; fresh full suite 418 tests / 38 files and build passed. The first actual Live typed run retained appointments and avoided feminine intake but still answered isolated Hello in English. After clearer English guidance, a fresh Live run answered two isolated Hello turns in Arabic with the existing Saud options, then switched for an explicit English request. Native audio was generated and playback completion simulated; this is not microphone ASR or perceptual audio verification. The initial timeout and the model's broader consistency remain separate limitations. New instructions require a new Live session.

- Capture the failed reply, function result and delivery/booking state before assuming the cause.
- Distinguish spoken factual risk from database-write permission; do not describe one as proof of the other.
- Keep valid progress through presentation failures, but require fresh consent after an interrupted summary.
- Use Arabic and English sequence tests, including uncertainty, correction, unknown facts, incomplete details, replay and cancellation—not only exact sentences or happy-path bookings.
- Listen to audio and test microphones separately. A readable transcript and green typed test cannot judge voice quality.
- Keep changes proportional to the prototype. Add frameworks, distributed state or streaming only when a measured need earns them.

### 2026-10-03: Reception caption lifecycle and Saudi appointment projections

Observed microphone conversations omitted final transcription markers, leaving the first FIFO caption owner in place and consuming subsequent words. Assistant captions were published only once at completion, so streaming audio appeared without its bubble. Prior tests used explicit `finished` flags and same-session booking facts, missing both these event shapes and raw UTC appointment results returned to fresh sessions.

Retain a bounded caption owner through turn completion for trailing input fragments and retire every owner on the next caller onset, including empty completed turns, while preserving existing activity/consent sequences. Captions lack provider turn IDs, so cross-onset wording cannot be causally assigned to an older turn. Prefer current activity for display, log caption attribution as uncertain, and retain orphan fragments under separate display-only IDs without creating input/consent turns or changing command attribution. Carry stable IDs into UI updates; publish cumulative assistant text immediately under its output ID and expose text only once. Preserve audio-only replay records when captions trail completion. Add raw text chunk and boundary diagnostics with correlation IDs. Scroll only the log list on opening and incoming events.

Project derived bilingual Saudi labels at response/snapshot boundaries for every timestamp-bearing appointment or offer, including lookup/select, durable operations and cached events. Refresh relative dates against the injected current server clock without rewriting UTC appointment truth, versions or persisted results. Concise persona guidance permits first-name-only intake, forbids invented surnames and gender assumptions from noisy captions, and provides مُجَمَّع pronunciation guidance; it is a mitigation, not an audio guarantee.

New regression tests were observed failing before the corresponding repairs. The full suite passes 607 tests/52 files and the production build passes. Live verification uses isolated in-memory databases, actual generated audio and independent saved-name/time/effect checks. Its narrow spoken-time assertion catches the specific UTC-versus-Riyadh failure only in the smoke scenario. Microphone recognition, audible pronunciation and accent quality require separate listening trials.

Review corrections exposed two further caption boundaries. Three new regressions and an updated cross-onset fixture failed before correction; fresh final verification passes 610 tests across 52 files and the production build/typecheck. Exact attribution of a genuinely old fragment after a newer onset remains unavailable from provider events and is explicitly uncertain rather than inferred from FIFO order.

### 2026-10-04: Recover an unclear booking offer without weakening consent

The observed booking failure was not a database phone-number constraint. A stale offer was refreshed; after an ambiguous answer the model moved on to collect a name, then tried to accept using that name turn. The server rejected it because the active offer was not tied to that assistant output and caller turn, so no appointment was saved. The test suite missed this sequence because it mostly scripted clean tool order, and the server-test helper reused one literal output ID, making unrelated assistant turns look like the same presentation.

Keep the stale-offer and exact-output/subsequent-known-turn checks. When an acceptance needs clarification and the offer is still active, associate that offer with the next assistant output; guide Gemini to restate the booking's doctor, exact date and time and ask briefly before waiting for a new caller turn. This makes a valid recovery possible without treating the ambiguous response, a name, or a phone number as consent. A ready result still writes nothing; only a committed result proves the simulated booking. This output association is not semantic speech verification, so model wording remains a live-test limitation.

Added a controller-plus-real-service regression derived from the failure sequence, with distinct output IDs, a stale offer refresh, ambiguous reply, erroneous name-turn acceptance, clarification, fresh assent and database assertions for the saved doctor/time/effect. Added a server regression proving a different intervening output cannot satisfy presentation, and prompt assertions for the recovery guidance. No live Gemini call or microphone was used; offline tests cannot prove that the live model follows its wording guidance. Full suite and production build/typecheck results are recorded in the bugfix plan.

### 2026-10-04: Describe availability as a range, then verify the chosen start

The caller-facing issue was that broad searches could present the next single 15-minute start, even when many later starts were open. Broad searches now group adjacent, actually bookable appointment starts into localized ranges, splitting at occupied or otherwise unusable starts. A discovery lookup may populate synthetic capacity and session state, but it issues no consent-eligible offers, reservation, or appointment. Once the caller picks a start, the agent must run an exact-time search scoped to that one date, present that specific time, and wait for agreement; only the server's later committed result proves the booking. If the exact time has no single-day scope, the server asks for the date rather than returning the same time across different days.

The active server already generates 31 days of 15-minute capacity (992 starts per doctor) on demand, and existing occupancy is considered when building ranges. There is no need to bulk-add more rows to the persistent demo database. A disposable-database regression confirms an existing past capacity row is not offered; additional cases cover range gaps, unclear/qualified/declined answers, changed selections before commit, keeping older offer IDs out of a later broad-range presentation, and rejecting omitted/multi-day exact-time scopes. This preserves the prior demo data while improving the agent's description of what it can book.

### 2026-10-04: Tester-facing name and production diagnostics

The web prototype is branded **Sahlan Voice (سهلان فويس)** with the descriptor “Bilingual clinic reception, in Arabic and English.” This is a prototype label, not a clinic brand or trademark-cleared name; the fictional clinic name used by the agent remains separate. The developer test log is available in local development/test builds only. Production mode neither renders the panel nor reads, collects, or stores those browser diagnostic events. A production preview exposed that Vite's `DEV` value can remain true under a production mode override, so the gate uses the resolved build mode instead. Hosting research and its persistence/deployment requirements are recorded in [hosting options](hosting-options.md); no hosting provider or domain was provisioned.
