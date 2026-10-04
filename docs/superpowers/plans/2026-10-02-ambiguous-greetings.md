# Ambiguous greetings and caller wording

Goal: keep a short, uncertain greeting from changing the language or restarting an ongoing appointment conversation; avoid inferring caller gender from noisy ASR.

Design: keep direct Gemini Live. Combine conversational Arabic guidance with the existing local language detector. A standalone hello/alo keeps the active language; an explicit Arabic ألو selects Arabic; a clear English sentence selects English. Do not rewrite microphone captions or pretend to repair recognition. Prefer natural gender-neutral questions unless the caller explicitly establishes how they want to be addressed.

Alternatives considered: prompt-only leaves the local detector inconsistent; another recognition model adds latency and complexity. No new model, voice, speech filter, or booking-state changes.

Execution (existing isolated codex/gemini-health-agent worktree; user's standing instruction is to use recommendations without prompting):

- [x] Add failing language regressions for ambiguous hello, Arabic ألو, and clear English speech.
- [x] Update language detection and Arabic prompt guidance, removing the conflicting standalone English Hello example.
- [x] Run targeted tests, actual Live text conversation in both languages, and full tests/build.
- [x] Record latest timeout evidence and testing limitations in the decision log. Preserve active user session and database; do not commit or push.

Latest failure evidence: session 91af8ae6-7edc-43e8-b540-1d6986fee305, 05:34 Riyadh. get_available_slots returned successfully in 118 ms. A subsequent incomplete reply “معاك إذا تحب” hit the delivery timeout. Two microphone captions “Hello.” caused English re-greetings; returning to Arabic booking caused Gemini to ask for the doctor again despite available slots still in application context. No booking write was attempted. The timeout cause upstream of the delivery gate is not established by these logs.
