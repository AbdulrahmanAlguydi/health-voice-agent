# December → January speech policy

User-approved refinement: an appointment in the immediately following January is obvious when today is in December. Omit its year in availability and booking speech, but keep full ISO dates and all confirmation safeguards. Do not extend the exception to February, a later January or non-December requests. Use Gregorian calendar dates in Asia/Riyadh.

- [x] Add failing Arabic/English formatter and booking-flow rollover regressions, including exception boundaries.
- [x] Align shared date presentation, Live guidance and verifier date context; no database schema or consent changes.
- [x] Run regression suite/build and real semantic-verifier probes with a simulated December clock.
- [x] Update the living design and report the observed output.

Evidence: 353 automated tests / 30 files passed; production typecheck/build passed. Simulated December 2026 booking preparation/confirmation omitted January 2027's year in Arabic/English while preserving `2027-01-03T09:00:00.000Z`. Formatter tests cover Riyadh's November/December midnight boundary, February and January two years later. Six real-verifier cases passed across the final run and a one-case retry: Arabic/English next-January omission, authored yearless January grounding, February/later-January rejection, and changed-hour rejection. The first verifier run incorrectly accepted February omission; explicit boundary guidance corrected it. One provider error on the changed-hour case required rerunning that case. Semantic verification remains probabilistic. No Live voice session, human microphone test, production date override or demo booking writes were performed for these probes.
