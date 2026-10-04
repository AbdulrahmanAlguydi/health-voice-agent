# Selective voice verification implementation plan

**Approved by the user:** Use a one-time approved opening recording, bypass the second-model check for ordinary conversation, and retain verification for database answers and identity/booking readbacks. Remove unnecessary duplicate wording constraints. The user accepts that a non-factual routing heuristic cannot guarantee every spoken claim is grounded; server function/state/consent guards remain authoritative for writes.

**Execution:** Inline in the existing isolated worktree; preserve other edits and do not run another broad review or commit unrelated untracked source.

## Tasks

- [x] Add a conversation verification policy to the audio gate and a small risk router that sends concrete values/actions to the existing verifier rather than rejecting vocabulary. Default required mode remains for critical outputs. Test ordinary Arabic/English, casual follow-ups after directory reads, unsupported facts, intake steps, and verifier outages.
- [x] Classify tool results by their application role: informational/identity/availability/booking readbacks require verification; non-factual clarification, acknowledgement, error and closing replies do not. Remove exact scope-refusal wording and preserve reception-only function restrictions. Batched directory reads retain linked evidence and permit relevant-field answers. No changes to transaction/consent/playback guards.
- [x] Generate and verify an opening clip in the configured voice using the existing Live model; save its PCM and trusted caption as a separate lazy-loaded asset. Current user setting is Fenrir, not Kore; preserved that voice. The app plays this without regenerating or transcribing it on each session and seeds the Live conversation with its model turn. Test playback, stale loading, voice mismatch and fallback. A missing/mismatched recording uses a generated opening with meaning-based (not exact) verification. Existing interruption/disconnect tests continue to pass.
- [x] Run all tests/build and typed Arabic/English Live regressions. Count verifier calls and record results, latency tradeoffs and heuristic limitations in the living design and README. Keep the app running for user testing.

**Files:** `src/client/agent/guardrails.ts`, new `src/client/agent/outputVerificationPolicy.ts`, `src/client/voice/session.ts`, new `src/client/voice/welcomeAudio.ts`, `src/shared/geminiLiveConfig.ts`, new `scripts/generate-welcome-audio.ts`, new lazy-loaded `src/client/voice/assets/welcome.json`, focused client tests and existing smoke script.

**Test sequence:** Write failing behavior tests → run to confirm failures → implement minimal changes → rerun focused tests → full suite and build → real-provider dialogue. Asset generation is an explicit implementation artifact, never a browser microphone test. No claims that disabling casual-output verification improves the underlying Live voice or ASR accuracy.
