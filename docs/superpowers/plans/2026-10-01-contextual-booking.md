# Contextual booking corrections

- [x] Add regression tests for current-year spoken dates and contradictory confirmations.
- [x] Share a Riyadh-aware date formatter; retain ISO dates, omit only the current year in speech.
- [x] Align agent and verifier guidance: advance known intent, retain preferences, treat changed details as corrections rather than consent.
- [x] Exercise actual Arabic Live conversations against an isolated seeded database: missing doctor, unavailable time, changed confirmation.
- [x] Run tests/build and record observed outcomes and limitations.

## Evidence

344 automated tests / 30 files and production typecheck/build passed. Four final actual Gemini Live Arabic typed-input runs passed (21 caller turns total): unknown doctor + unavailable hour/day, then three separate changed-confirmation cases (doctor, day, hour). Each used a disposable in-memory database and ended with zero appointment rows. Native audio was generated and playback completion simulated; this is not a microphone/ASR or listening-quality evaluation. Full approved transcripts and function statuses are saved in `../booking-context-{availability,doctor,day,time}.json`.

Tests exposed and repaired rejection of the ordered cancellation/availability batch and a false output rejection for omitting a repeated doctor name/closing availability question. A single cancellation now refreshes the known doctor's schedule, rather than leaving the model to recite ungrounded past availability. Verified identity survives a slot correction. Preparation/commit/identity batches remain blocked.

Four direct real-verifier probes accepted Arabic/English current-year omission in final consent and rejected a changed hour or omitted future year. The first Arabic probe encountered a temporary provider/endpoint error; its retry passed. Semantic verification remains probabilistic and provider availability can still withhold factual audio. Wording guidance reduces redundant intros but is not a deterministic guarantee of identical phrasing; brief greeting/filler variations occurred across repeated runs.
