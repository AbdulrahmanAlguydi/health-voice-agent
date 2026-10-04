# Local output verification

Approved design: use Gemini Live only in the running prototype. Replace the remote semantic verdict with a local verifier; accept natural connective wording and do not attempt to judge qualitative claims. Retain database/tool authority, identity readback, calendar/time evidence, fresh booking consent and transactional availability checks. Whole-turn buffering is unchanged.

## Implementation

- [x] Add failing Arabic/English local-check tests: grounded doctor names with free wording pass; unknown titled names, changed numbers and dates fail; final readbacks cannot use relative-only dates.
- [x] Implement a local verifier using normalized evidence, exact supplied calendar alternatives and protected identity details. Wire it as the session default without network requests.
- [x] Stop constructing the server's second-model verifier. Preserve injectable legacy verifier for existing tests and diagnostics, not the running application.
- [x] Run targeted tests, full suite, typecheck/build; update living documentation with the accepted limitations. Do not change voice, opening, database, or audio streaming in this task.

Verification: 380 tests / 34 files and production build passed. Final real Live typed-input runs accepted Arabic dentistry doctor names, Arabic named-doctor specialty and an English dermatology doctor list, with zero remote-verifier requests. Initial Arabic specialty/English list runs falsely demanded unused clinic/count digits; a failing regression test and directory-only correction fixed this. These tests used native audio and simulated playback completion, not human listening/microphone evaluation. No appointments were committed.
