---
title: 'Replay synthesized caller speech through Gemini Live'
type: 'feature'
ticket: ''
created: '2026-10-03'
status: 'done'
baseline_revision: 'ceab68c356bcf24146b4a43d58d34ab3b142ae7e'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Typed Live smokes exercise booking tools and database effects but bypass speech recognition, so they missed audio-related failures such as wrong heard names, partial phone numbers, caller turns disappearing, and replies with no recorded voice.

**Approach:** Add a small, cached Arabic/English caller-audio corpus generated with Gemini TTS and an opt-in smoke mode that streams those PCM clips through the existing Gemini Live microphone interface. Keep the current text smoke intact. Check provider transcripts and recorded agent speech alongside the authoritative disposable database result.

## Boundaries & Constraints

**Always:** Use synthetic utterances and the existing Live controller/audio route; preserve timing/chunking of a real microphone stream; store fixtures and reports only under ignored `output/reception-live/`; keep database effects isolated in memory; record actual input captions, tool results, agent transcripts/audio, and saved appointment facts; test Arabic and English; tolerate natural transcript wording variation.

**Never:** Change the browser's production microphone flow, system prompt, data model, booking rules, persistent demo database, or agent voice behavior. Do not treat TTS test speech as proof of real Saudi-accent recognition or human voice quality. Do not use exact agent-sentence matching as a playback gate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid audio turn | Mono PCM16 WAV, 16 kHz | Stream 100 ms frames through one microphone turn; wait for response; save transcript/audio facts | Bound each response wait and label failing turn |
| Invalid fixture | Missing file, malformed WAV, wrong encoding/rate | Fail locally before contacting Live | Explain fixture generation/format problem without dumping secrets |
| Arabic/English guest booking | TTS caller, first name only, partial then complete mobile, accepted database offer | Persist one appointment with the chosen doctor/time, caller's supplied first name and confirmed number; no write from partial digits | Report mismatch from database independently of model's spoken claim |
| Agent reply without audio | Live turn returns text but no PCM | Mark the scenario failed even if the transcript exists | Include the missing audio turn in the report |

</frozen-after-approval>

## Code Map

- `scripts/smoke-reception.ts` -- disposable SQLite + local Express + actual Live controller harness; currently sends `sendText`, records agent audio and checks appointments. Extend behind an opt-in audio flag; retain the typed route and existing assertions.
- `src/client/voice/receptionSession.ts` -- existing `beginMicrophoneTurn`, `sendMicrophoneAudio` (16 kHz PCM), `endMicrophoneStream`, patient-caption callback, and recorded-output callback. Reuse; do not alter production transport.
- `src/shared/receptionPrompt.ts` -- config already enables Arabic/English Live input transcription. No prompt edits required.
- `tests/client/reception-session.test.ts` -- offline Vitest conventions and fake Live port; the new WAV parser/chunker can be tested without API access.
- `package.json` -- existing test/typecheck/build commands; add explicit fixture-generation and audio-smoke commands.
- `README.md` -- smoke script documentation and known limits; clarify that cached synthesized caller speech is not a real microphone/accent evaluation.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/receptionAudio.ts` -- parse/validate PCM16 16 kHz mono WAV, wrap generated raw PCM as WAV, and stream 100 ms chunks using one controller microphone turn -- share reliable audio framing between generation and replay.
- [x] `scripts/generate-reception-audio.ts` -- create or reuse stable Arabic/English caller utterance fixtures using the configured Gemini API key and a single TTS voice -- no API generation during ordinary offline tests or repeated smoke runs.
- [x] `scripts/smoke-reception.ts` and `package.json` -- add explicit audio replay mode; attach caller caption capture; preserve existing typed mode; assert DB booking facts and non-empty agent PCM -- exercise the actual Live audio-input path.
- [x] `tests/scripts/receptionAudio.test.ts` -- cover WAV round trip, chunk sizes/final remainder, bad headers/format, and missing fixture handling -- make framing regressions deterministic offline.
- [x] `README.md` -- document fixture generation, Arabic/English replay commands, outputs, API usage, and evaluation limits -- make the new testing path usable and honest.

**Acceptance Criteria:**
- Given no Gemini credentials, when offline tests run, then WAV parsing/framing tests pass without network calls or demo database changes.
- Given cached Arabic or English fixtures, when audio smoke runs, then Live receives microphone PCM frames, the report captures patient transcripts and agent audio, and the disposable DB—not spoken text—proves the saved appointment's identity, doctor, time and contact.
- Given an invalid fixture or missing agent audio, when the audio smoke runs, then it fails with a useful turn/fixture diagnosis and leaves persistent demo data unchanged.
- Given a prior typed smoke invocation, when run without the new audio flag, then its existing typed behavior remains unchanged.

## Implementation Notes

- Gemini 3.8 TTS's current documented SDK path is `interactions.create`; unary requests return 24 kHz WAV, which the fixture builder linearly resamples to 16 kHz PCM. The TTS key's free tier allowed ten requests that day, so eight Arabic fixtures were generated before English generation hit HTTP 429. Successful files are cached and the generator resumes rather than regenerating them.
- First Live replay revealed the actual browser keeps the microphone input stream open between speech turns and continuously sends samples, including silence. Sending `audioStreamEnd` after each prerecorded caller sentence did not produce a response; stopping after 900 ms of silence also left the first turn open. A 1,500 ms silence tail while keeping the stream open produced reliable Live turn completion. One full Arabic audio smoke passed: all eight caller turns were transcribed, invalid partial contact did not create an appointment, and the single committed appointment matched Ahmed, the confirmed phone, and the accepted doctor/time. The report is under ignored `output/reception-live/2026-10-03T13-26-04-965Z-ar-dictated-audio/`.
- The Gemini TTS free-tier cap returned HTTP 429 after generating the eight Arabic fixtures, before an English batch was available. English recognition and booking were still exercised using eight temporary local Windows TTS fixtures (Microsoft David Desktop); the one-turn-per-fixture Live flow, partial-number recovery, agent audio, and saved database result all passed. This verifies the English audio route, not Gemini's English TTS output. The English report is under ignored `output/reception-live/2026-10-03T13-31-16-567Z-en-dictated-audio/`; use `--force` after TTS quota is available to replace local English fixtures with Gemini-generated ones.
- To avoid spending the daily TTS allowance regenerating valid clips in both languages, the fixture generator supports `--language=ar|en`; `--force --language=en` replaces only English clips after quota is available.
- The English run surfaced a prompt-level guardrail miss: after `accept_offer` returned `invalid_contact`, the agent said the slot was “reserved,” even though no appointment was saved yet. The later result committed exactly one matching booking; this harness deliberately does not edit prompt/workflow behavior, so retain the turn transcript in the report for a separate fix.

## Plan Change Log

## Review Triage Log

- Quick review of the complete share-ready snapshot (including the audio replay files) found one medium README mismatch about the active versus legacy SQLite database; that documentation was corrected before push. No audio replay finding remained.

## Design Notes

Fixtures are test callers, not prerecorded agent lines. Generate once and cache to avoid paying for TTS on every replay. Audio input uses the controller's current microphone API (PCM16, 16 kHz, mono); WAV headers are stripped before streaming. Keep TTS prompts clear but natural; do not assert exact ASR spelling where multiple scripts are valid. For booking, derive success and stored fields from `ReceptionService.activity()`/SQLite. A clean offline result validates the harness, while Live replay adds recognition coverage but remains a flaky, provider-backed smoke rather than a deterministic unit test.

## Verification

**Commands:**
- `npm test` -- 648 tests passed across 54 files at final completion, including the offline WAV/audio framing tests.
- `npm run build` -- typecheck and production Vite build passed.
- Arabic Live audio replay report at `output/reception-live/2026-10-03T13-26-04-965Z-ar-dictated-audio/report.json` -- `failures: 0`, database effects passed, one saved appointment, and nine recorded agent outputs with non-empty PCM.
- English Live audio replay report at `output/reception-live/2026-10-03T13-31-16-567Z-en-dictated-audio/report.json` -- `failures: 0`, database effects passed, one saved appointment, and nine recorded agent outputs with non-empty PCM. English fixtures for this run used local Windows TTS after Gemini TTS quota was reached.

The report checks prove the test harness exercised Live audio and database effects; they do not certify natural voice quality or real-microphone Saudi-accent recognition.

**Manual checks (if no CLI):**
- Inspect the generated report and listen to a saved agent response only if needed; confirm user data are synthetic and output/report paths stay under ignored `output/reception-live/`.
