# Single booking confirmation

Goal: eliminate the separate guest slot-consent gate and allow a caller to answer the complete displayed final summary without waiting for all audio playback.

Design: retain ID choice, available-slot validation, actual caller contact digits and atomic database commit. Guest preparation is an uncommitted draft and needs no preliminary yes. One final summary is presented before one fresh explicit confirmation. In this web prototype, the full displayed summary is sufficient delivery; interrupted audio does not force a repeat. No summary presentation or no clear fresh yes means no write. Failed/withheld output is not presentation. This does not certify what the patient actually heard and is not a telephone-production design.

Compared options: shortening speech alone would leave the playback loop; removing all consent would allow unwanted writes. Use one final consent after a displayed summary.

Arabic: prefer natural recipient wording (نحجز لك، نشوف لك), not bare transaction verbs. Continue without a patient ID rather than saying كضيف. Guidance, not mandatory recorded lines.

- [x] Reproduce preparation without an early yes and confirmation after shown summary in regression tests.
- [x] Remove the guest early-consent prerequisite; add pending-summary presentation evidence distinct from completed playback.
- [x] Update function descriptions and conversational guidance; test Arabic/English booking against disposable databases.
- [x] Run full suite/build and document rationale/limitations. No reset, commit or push; preserve user's active session.

Verification: fresh 421 tests / 38 files passed; typecheck/build passed. Actual Live English and updated seven-turn Arabic guest flows each saved one appointment in memory. The native voice was Fenrir, playback completion simulated. Both repaired partial phone numbers and reached confirmed with one final confirmation question. The microphone interruption regression confirms the displayed-summary boundary independently.

Remaining observation: the updated Arabic Live run said «حجزنا لموعد يوم الأحد» at the ID question before any preparation/write, despite the prompt telling it not to claim success. The script's narrow premature-booking phrase matcher missed this variant; its zero scenario failures is not proof of universally correct speech. The database did not commit early. No new sentence blocker was added. Pronunciation/voice naturalness still needs listening, including this run's «اتناشر» wording.

Evidence: session a59d3265-a690-4384-b09e-a46c156bfb77. Guest preparation at 05:49:55 returned awaiting_guest_consent, not pending. Gemini asked a final-looking question anyway. Later preparation succeeded; repeated affirmative microphone replies interrupted the long summary, keeping readbackComplete false and preventing commit.
