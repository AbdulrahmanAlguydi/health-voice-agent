# Booking recovery implementation plan

**Goal:** Correct the observed booking loop and skipped patient-ID choice, retaining the direct Gemini prototype.

**Architecture:** Keep conversational speech ungated. Enforce guest-path selection and transaction stages in `tools.ts`, accept ordinary Arabic/English consent locally, and retain offered times across identification. Refresh only the cached opening; all later audio stays native Live with the same configured voice.

**Constraints:** No new framework, second runtime model, full workflow migration, database reset, or changes to the user's open conversation. Test commits use disposable SQLite only. Do not claim typed tests evaluate microphone recognition or perceived voice consistency.

- [x] Reproduce the actual failure from rendered Chrome diagnostics: skipped `begin_booking`, unrecognized “اي، احجز لي هنا”, repeated `awaiting_guest_consent`, then `confirm_booking` without a pending draft. Confirm that the model padded an incomplete number to 1234567.
- [x] Write and observe failing regression tests in `tests/client/booking-recovery.test.ts`; exercise real tool handling, Express routes and in-memory SQLite.
- [x] Redirect guest-only actions to the existing patient-ID choice, add stage-specific recovery guidance, preserve availability across lookup, and reject supplied function digits that conflict with observed guest-contact digits.
- [x] Broaden ordinary consent fillers while continuing to reject changed times/dates/doctors; test Arabic and English completed guest and registered transactions.
- [x] Allow incomplete mobile input in the model-facing function schema so the function can return a repair instead of encouraging padded arguments. Server validation remains unchanged.
- [x] Refresh the Fenrir opening using the current prompt. Keep live voice fixed and add consistent delivery guidance rather than prerecorded booking dialogue.
- [x] Run actual Gemini conversations via `scripts/smoke-completed-booking.ts`, `--english`, and `--registered`. Verify a single saved appointment and ID choice, not only preparation/cancellation. Retain transcripts and failures in the reports.
- [x] Run `npm test` and `npm run build`, update the decision log and living design with results and remaining audio limitations.

The first native guest runs exposed an additional rejected English consent (“Yes, please book that time”) and required answering a separate final summary. Preserve those findings; do not turn an initial slot agreement into final write authorization.

## Verification

- Offline: 413 tests across 38 files passed; typecheck and production build passed.
- Final Live Arabic guest: 8 caller turns, patient-ID question after slot selection, partial-number repair, preparation then fresh final confirmation, 1 saved test appointment, 0 scenario failures.
- Final Live English guest: 8 caller turns, same flow, English repair retained English, 1 saved test appointment, 0 scenario failures.
- Live Arabic registered: 5 caller turns, existing ID 123, identity readback/affirmation, preparation/final confirmation, 1 appointment linked to 123, 0 scenario failures.
- All three used Fenrir. None changed the running demo database. Typed tests generate PCM but do not assess how it sounds. The opening was regenerated again after the final prompt changes.
- Earlier runs produced an unclear Arabic patient-ID label and one premature spoken booking claim. Both prompted objective/instruction changes; speech remains probabilistic because global speech verification was deliberately not restored.
