---
title: 'Share-ready prototype polish'
type: 'chore'
ticket: ''
created: '2026-10-04'
status: 'built'
baseline_revision: 'ceab68c356bcf24146b4a43d58d34ab3b142ae7e'
route: 'oneshot'
route_source: 'pinned'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md', '{project-root}/README.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The prototype has a generic public-facing identity and exposes its developer test log in the normal app UI. The private GitHub repository also needs a clean, tested project snapshot suitable for sharing with reviewers.

**Approach:** Choose a distinctive bilingual-friendly prototype name after checking obvious collisions, apply it to the visible app identity, gate diagnostics and their browser persistence to development builds, add regression coverage, clarify the demo README, and push the verified project to its existing private GitHub repository. Research hosting/domain options without deploying or changing infrastructure.

</frozen-after-approval>

## Implementation Notes

Using the oneshot route because this is a bounded release-preparation change, not a new booking feature or architecture redesign. Existing booking behavior and local persistent demo data remain untouched.

- Selected Sahlan Voice (سهلان فويس) after a preliminary name-collision screen; no trademark or domain clearance is claimed. Kept the fictional clinic name separate.
- Added a mode-based diagnostics gate; production builds hide the panel and bypass browser-log load/append/copy/clear, while local development and test builds retain the workflow. A production preview initially showed the panel because Vite `DEV` was true despite production `MODE`; the resolved mode is now authoritative.
- Added a regression test for hidden/unpersisted diagnostics and documented free-host trade-offs in `docs/hosting-options.md`. No service was deployed.
- Quick-review triage: fixed one medium-severity documentation finding. The README had described the legacy database/reset command as the active booking store; it now distinguishes `data/reception.sqlite` from the legacy `data/health-voice-agent.sqlite` and warns that the old reset does not clear active reception bookings.

## Verification

**Commands:**
- `npm test` -- all offline regression tests pass.
- `npm run typecheck` -- no TypeScript errors.
- `npm run build` -- production bundle succeeds.
- Browser smoke check against the built app -- branded tester UI renders; no test-log panel is visible and no diagnostic events are stored in browser storage.
- Git audit before push -- `.env`, SQLite files, backups, generated audio/transcripts, and browser artifacts are absent from the staged commit; GitHub repository remains private.
- Final run after review correction: 647 tests pass across 54 files; production build and typecheck pass; `git diff --cached --check` passes. Quick review's database/reset documentation finding is fixed.
