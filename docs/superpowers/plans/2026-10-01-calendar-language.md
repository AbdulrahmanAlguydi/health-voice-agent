# Appointment calendar language

Patient-approved scope: app-computed Umm al-Qura conversion on request; accurate relative availability wording; absolute calendar date/time for final consent and success. UTC appointment identity and consent checks remain unchanged. Gregorian months are calendar months, not 30-day approximations. Count civil days in Asia/Riyadh; preserve unit remainders.

- [x] Test date arithmetic, known Umm al-Qura reference conversion, Riyadh midnight, leap/month-end/year boundaries and availability/final-readback separation.
- [x] Return Gregorian/Hijri/relative labels for slots; allow dateStyle selection in the availability function.
- [x] Ground semantic verification in these paired labels and disallow relative-only final readbacks.
- [x] Test actual Arabic/English model responses and semantic acceptance/rejection; run suite/build and document limits.

## Evidence and boundaries

373 automated tests / 33 files passed; production typecheck/build passed. Date arithmetic uses Gregorian civil dates in Asia/Riyadh, not elapsed 24-hour rounding. Whole Gregorian months use a same-day anniversary clamped to the destination month's last day; remaining civil days are retained. Short spans use days, intermediate spans weeks plus remaining days, longer spans calendar months plus remaining days. This is a defined Gregorian month duration, not a claimed Hijri-month duration.

Conversion uses native `Intl.DateTimeFormat` with explicit `calendar: islamic-umalqura` and asserts the runtime honoured that calendar. The independent documented reference 14 October 2017 = 24 Muharram 1439 passed, alongside Riyadh midnight and leap/month-end/year cases. Supported calendar names: [Unicode CLDR](https://github.com/unicode-org/cldr/blob/main/common/bcp47/calendar.xml); reference conversion: [MDN Intl](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl).

Eight final caller turns across actual Arabic/English Gemini Live sessions passed, with native generated audio and simulated playback completion. Relative days/weeks/months, explicit Hijri conversion, identity and an absolute Hijri final readback were exercised. Disposable memory DB only; zero appointments committed. Initial Arabic calendar-equivalence false rejection and loss of calendar preference were corrected. The final English run encountered one transient verifier error handled by the existing retry. Full approved transcript: `../booking-context-calendar.json`.

Five real text-verifier cases passed across the final run and a one-case provider-error retry: accurate Arabic days/English weeks plus remainder, rejection of rounded week wording, acceptance of absolute Hijri final readback, rejection of relative-only final consent. Reproduce with `npx tsx scripts/smoke-calendar-verification.ts` and `npx tsx scripts/smoke-booking-context.ts --calendar`. These are not human-microphone/accent evaluations; semantic classification/provider availability remain probabilistic. Umm al-Qura is the named civil-calendar convention, not a guarantee of every local moon-sighting calendar. No general Hijri-input-to-ISO parser or arbitrary calendar-conversion service was added.
