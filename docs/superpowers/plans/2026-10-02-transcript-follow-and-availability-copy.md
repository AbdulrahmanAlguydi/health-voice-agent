# Transcript follow and availability wording

Goal: verify HA-FCB79B without writes, keep the newest chat content visible, and distinguish an available slot from a completed booking in natural Arabic.

Design: scroll only the transcript container to its bottom after message/partial-text updates, without moving keyboard focus or restarting animated scrolling during transcription. Keep all bubbles and audio replay. Before confirmation, describe the selected slot as available; after a successful commit describe it as booked. This is prompt guidance and fallback copy, not a new sentence verifier.

Alternatives: an end-marker scrollIntoView can move the entire page; smooth scrolling per streamed update can repeatedly restart animations. Direct container scrolling is recommended for this prototype and follows the user's explicit request to follow each new message.

Plan (inline execution, no commit/push or database mutation):
- [x] Add failing real-component regressions for patient/assistant additions and partial-text updates, asserting container scrollTop reaches scrollHeight and earlier bubbles/focus remain.
- [x] Add the container ref and post-render scroll effect to Transcript.tsx.
- [x] Replace the Arabic registered-draft fallback in bookingService.ts with availability wording and add the same natural-speaking guidance to geminiLiveConfig.ts. No phrase-enforcement code.
- [x] Run component regressions, full tests and build. Run one actual Arabic typed Live booking against disposable SQLite to observe availability wording; no writes to the user's database.
- [x] Update main design/decision rationale with verified saved booking and results.

Read-only verification: HA-FCB79B exists, doctor د. ندى الخطيب, starts_at_utc 2026-10-04T14:00:00.000Z (17:00 Riyadh), slot status booked. It was created at 2026-10-02T09:56:30.614Z.

Verification: both scroll regressions failed with scrollTop=0 before implementation and passed afterward. Full suite 473 tests / 41 files passed; production build and typecheck passed. The real Arabic typed Live run said «الموعد متاح مع د. ندى الخطيب يوم الأحد، ٤ أكتوبر في ١٢:٠٠ الظهر. أحجزه لك؟» before approval and «حجزت لك موعد...» after a successful confirmation. Exactly one appointment was saved in disposable memory, with zero reported scenario failures. The initially transliterated name query also recovered with the original-name hint on this run. Native audio was generated, but playback completion was simulated; this is not microphone or listening verification. Results are in completed-booking-ar-registered-latest-identity.json. Persistent booking HA-FCB79B was not altered. Changes remain in the existing worktree, without commit/push.
