---
title: 'Adopt Rafiq as the prototype name'
type: 'chore'
ticket: ''
created: '2026-10-05'
status: 'built'
baseline_revision: 'd312faa1369d8159e92ed83a0931d8f15fd2e579'
route: 'oneshot'
route_source: 'pinned'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md', '{project-root}/README.md']
---

<frozen-after-approval reason="human-owned intent — user selected Rafiq from proposed names">

## Intent

**Problem:** The prototype is currently labeled Sahlan Voice, and the user chose Rafiq as the replacement name.

**Approach:** Apply **Rafiq (رفيق)** to the user-visible app header, browser title, README, and current branding record. Preserve the fictional clinic name, app/repository identifiers, booking behavior, and voice prompt; state that the product name has not received legal/domain clearance.

</frozen-after-approval>

## Implementation Notes

Using the oneshot route because this is a small, cross-file copy/identity update. The prior Sahlan decision remains historical but must be marked as superseded. No agent prompt, clinical scope, data, or hosting changes are in scope.

- The new UI regression failed on the old Sahlan heading, then passed after the header was changed to Rafiq/رفيق.
- Updated the app heading, HTML title, current README identity, and decision history. Kept Afiyah Medical Center, repository/package identifiers, prompt, and booking behavior unchanged.
- The earlier release-preparation note now labels Sahlan Voice as superseded rather than current.
- Quick-review finding patched: the older decision-log entry now explicitly says its Sahlan label was superseded on 2026-10-05, avoiding an apparent conflict with the Rafiq entry.

## Review Triage Log

- Quick review, pass 1: `low` — `docs/decision-log.md` still called Sahlan the current brand. Route: patch; rewrote that entry as historical and pointed to the 2026-10-05 Rafiq decision.

## Verification

**Commands:**
- `npm test` -- 648 tests passed across 54 files, including the visible branding regression.
- `npm run build` -- typecheck and production build passed.
- Built-site inspection -- `dist/index.html` title is Rafiq; client bundle contains Rafiq/رفيق and neither old Sahlan label.
