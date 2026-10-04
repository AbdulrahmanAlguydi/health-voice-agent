# Semantic booking actions implementation plan

Goal: stop using caption phrase lists as the normal judge of caller identity and booking agreement.

Architecture: Gemini Live interprets speech through explicit intent functions. The existing app context owns patient lookup, delivery, pending draft and fresh-turn eligibility. SQLite retains authoritative doctor/slot validation and atomic writes. No second model, recordings or framework migration.

## Tasks

- [x] Add failing integration tests for explicit identity decisions (own_record, not_mine, unclear), missing/old turn evidence and Arabic latest-session replay.
- [x] Add confirm_patient_identity with a required decision. Remove automatic identity acceptance from transcript listeners. Contact digits and legacy guest-consent fixtures remain; the latter are not exposed in the normal function menu. Require a found, delivered record and a fresh completed caller turn; consume it once. Unclear retains state; rejection clears the record; ownership permits preparation, never a commit.
- [x] Give confirm_booking a required decision (approve, decline, change, unclear). Remove phrase matching from the normal client/server commit path. Require a delivered draft and fresh completed caller evidence. Unclear retains the draft; change/decline cancel it; approval sends the explicit decision to the server. Missing decisions do not write.
- [x] Include authoritative bookingStage and allowedNextActions in every function response. Return identity clarification if premature confirmation occurs during identity, not a new ID request. After successful commit, retain a completion receipt and refuse duplicate confirmation writes.
- [x] Update Live function descriptions and Arabic guidance: confirm identity with the explicit function before preparation, distinguish pending draft from completed booking, never ask final approval after successful commit. Keep speech naturally generated.
- [x] Migrate regression fixtures to explicitly supplied semantic decisions; do not manufacture decisions in production from caption wording. Keep tests for no early/stale write, phone repair, replay, corrections and DB availability conflicts.
- [x] Run full tests/build plus real Live Arabic and English scenarios against disposable databases, repeat the latest-session identity phrases and confirmation, and record failures as well as successes. Do not claim typed tests validate microphone recognition or accent.
- [x] Update living design and decision rationale. Preserve persistent demo records, user changes and credentials. No commit/push requested.

## Verification and deviations

Fresh final offline run: **471 tests / 40 files passed**, `npm run build` passed (typecheck included; largest chunk 425.70 kB, no oversized warning). Site returned HTTP 200 at http://localhost:5173/. No reset, commit, push, credential edits or test writes to the persistent demo DB.

Added a narrow booking-status claim check after actual Live output said “حجزنا” before saving despite correct tool status. Red/green regressions show status repair must preserve pending-summary delivery, and successful «أكيد، تم الحجز» must not be blocked. The full controller regression repairs the incorrect claim, delivers the summary, and then confirms from fresh consent. This is not general sentence verification or a perfect fact checker.

Final retained successful reports contain **13 actual Live scenarios / 72 caller turns**: Arabic and English registered/guest booking, partial-number repair, identity replay, exact «اي، هذا الملف حقي», unknown doctor, unavailable time, changed doctor/day/hour after a draft, Arabic uncertain ownership, English rejected ownership, and an injected doctor-name transliteration error. Seven disposable appointments were saved in successful booking scenarios; six negative/correction episodes saved none. Native PCM is generated but playback completion is simulated, not listened to.

Two additional failed runs are retained as `failed-ar-name-transliteration.json` and `failed-forced-transliteration-retry.json`. A one-per-turn original-name hint is tested offline and recovered automatically in the final forced Live run; the first forced run ignored it. Do not generalize that recovery to all names or claim no future loop is possible. Exact alias matching intentionally does not guess another doctor.

Other observed limitations: ambiguous typed «اي هذا ما في» was interpreted as ownership by Gemini in the identity-recovery scenario; explicit uncertainty and rejection did correctly prevent writes in separate scenarios. Arabic «كضيف» appeared despite style guidance, and an English caption contained an unexplained trailing marker. Semantic interpretation, microphone recognition and perceived voice consistency are not certified by these scripts. See the decision log for rationale and the individual JSON transcripts for unedited evidence.
