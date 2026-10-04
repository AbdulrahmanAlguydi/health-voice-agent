# Prototype simplification implementation plan

> Execute inline with executing-plans and test-driven-development. User approved the focused direct-Gemini design and requested a quick plan review before implementation.

**Goal:** Remove wording-check failures, preserve booking progress across media failures, and expose useful diagnostic details without introducing infrastructure.

**Architecture:** Keep Gemini Live, Express and SQLite. The tool handler owns one local booking context; the session owns delivery state only. Default sessions collect audio/transcripts without validating sentence wording. Functions retain schema validation, identity/guest consent, fresh final confirmation and transactional availability checks.

**Constraints:** Arabic-first Saudi conversational tone; English support; database-only facts; no recommendations/clinical advice; no second model, new framework, database reset or automatic mutation retry. Natural spoken grounding remains probabilistic. Existing experimental checker utilities are not production enforcement.

## Quick review

- Keep: direct Gemini, action safeguards, bounded recovery, structured browser logs.
- Drop: LiveKit/Pipecat migration, backend workflow rewrite, distributed tracing, raw audio recording and full streaming-player rewrite.
- Preserve: existing pending drafts and known caller details when only delivery fails. An interrupted final summary cannot authorize booking.
- Risk: native speech may contain wrong facts despite valid function results; removing lexical gates does not replace them with a perfect intent checker.

## Task 1 — Delivery, not sentence matching

- [x] Add failing session regression for Saud's Arabic number-word availability and English paraphrasing.
- [x] Add a delivery-only mode to the existing output buffer; default sessions use it, while explicit injected verifiers remain diagnostic/test-only.
- [x] Keep interruption, missing-audio and timeout recovery. Assert natural output is played without extra HTTP/verifier calls.

## Task 2 — Small booking context and recovery

- [x] Consolidate handler booking fields into one context object without changing database contracts.
- [x] Test interrupted/failed final readback, blocked premature confirmation, replay and fresh consent.
- [x] Retain pending draft response for read-only replay; do not cancel drafts solely because audio failed. Ignore stale playback callbacks.
- [x] Allow ordered cancellation plus end-session; keep dependent mutating batches blocked.

## Task 3 — Observable diagnostics and handoff

- [x] Test structured detail persistence/export, nested credential redaction, and tool/media lifecycle diagnostics.
- [x] Log turn/session correlation, tool arguments/results, HTTP/tool timing, booking snapshots, generated transcript and media/recovery events. Never log tokens/audio base64; logging failures cannot stop conversation.
- [x] Update current design and README to match runtime; retain the larger research proposal as deferred alternatives.
- [x] Run all offline tests and production build; run Arabic/English typed Live smoke flows when credentials work, without committing demo appointments.

No commit/push or unrelated cleanup is part of this change.

## Verification results

- 403 offline tests across 37 files passed; TypeScript and production build passed, with no oversized chunk warning.
- Three actual Gemini Live typed-input flows: 8 Arabic guest-repair turns, 9 English unknown-fact/guest-repair turns, and 9 Arabic Saud/guest-repair/pending-summary replay turns. All generated audio, used zero verifier requests and closed after cancellation. No confirm_booking call or appointment/profile commit occurred.
- Arabic pending replay returned the same pending draft without another prepare call. Both languages handled cancel + end batches. Arabic full-name guidance accepted «بدر بدر»; remaining awkward/formal wording is a listening/tone limitation, not proof of fully human delivery.
- Offline regressions cover Arabic spoken hour words, English paraphrases, interrupted/failed summaries, blocked premature consent, stale playback after disconnect, retained guest agreement, structured log export and collectors throwing.
- Live playback completion was simulated from generated PCM duration; microphone ASR, perceived pronunciation/pacing and real audio-device interruptions still need user testing.
- Existing linked worktree retained on codex/gemini-health-agent. No database reset, infrastructure migration, commit or push.
