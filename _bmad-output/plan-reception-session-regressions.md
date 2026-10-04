---
title: 'Fix observed reception conversation regressions'
type: bugfix
ticket: ''
created: '2026-10-03'
status: built
baseline_revision: ceab68c356bcf24146b4a43d58d34ab3b142ae7e
route: full
route_source: auto
review: quick
review_source: pinned
lenses_ran: [quick]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="User explicitly requested all diagnosed fixes and delegated routine implementation without further prompting">

## Intent

**Problem:** The latest real microphone conversations lost caller captions after the first turn, delayed agent bubbles until the whole response ended, misreported a saved Saudi appointment as UTC, and used backwards receptionist phrasing and an unsupported surname. Logs open at their oldest entry, making investigation difficult. Earlier tests did not reproduce these provider event shapes or fresh-session lookup.

**Approach:** Repair the existing thin transport and UI projections, consistently format appointment facts at the server result boundary, improve natural receptionist/name/pronunciation guidance without scripting replies, and add tests derived from the actual failures. Keep the architecture unchanged.

## Boundaries & Constraints

**Always:** Preserve existing demo bookings, dirty checkout edits, stable turn IDs, semantic consent, operation recovery and free-form Gemini speech. Work in this managed worktree. Use test-first regressions, disposable DBs and the real controller/UI where practical. State honest limits of model/audio tests. Routine decisions are delegated; no new approval gates are needed for these already requested fixes.

**Never:** Reset the database, add patient-ID intake, a second output judge, prerecorded lines, mandatory surname collection, strict transcript matching or a new booking confirmation. Do not commit/stage the unrelated untracked prototype baseline, push, or change credentials. Do not infer exact caller wording from missing captions. A pronunciation prompt is mitigation, not a guarantee.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Consecutive microphone turns | Caption chunks omit finished, then turnComplete, followed by different Arabic/English caller turns | Every turn stays visible separately; no stale queue head consumes later text | Captions never manufacture consent activity |
| Repeated onset/late caption | Multiple VAD onsets before caption or generationComplete before final caption | Preserve text under its own stable input ID; no vanished/merged caller bubbles | Explicit uncertain attribution remains unchanged |
| Streaming assistant text | Multiple outputTranscription chunks before turnComplete | One bubble updates immediately with accumulated text; replay record ends with complete text | No duplicate offer exposure or old output overwriting a new bubble |
| Fresh session lookup | Saved 2026-10-04T06:00:00Z appointment, Riyadh clock | Function returns 4 October 9 AM Gregorian/Hijri/relative labels, without changing stored time | Apply same projection to select, committed/recovered operations and restored results |
| Sparse caller name | Caller provides Ahmed only | Guidance permits first name, saves only supplied name, uses neutral address when uncertain | Do not invent surname, retrieve identity from phone, or add blanket readback |
| Reception wording | Greeting/name/time replies | Guidance frames caller as receiving help, pronunciation مُجَمَّع, no guessing gender from noisy ASR | Dynamic natural speech, not compulsory lines |
| Log opening | Many persisted entries, panel closed then opened | Scroll within log list to latest entry on every opening and incoming event | Do not scroll entire page |

</frozen-after-approval>

## Code Map

- `src/client/voice/receptionSession.ts`: microphoneCaptions FIFO only shifts on finished; finalizePatient marks current input but does not retire head. publishTranscript is one-shot, called only at completion. Preserve tool/context ownership.
- `src/client/voice/session.ts`: shared callback interface can gain optional inputTurnId for legacy compatibility.
- `src/client/App.tsx`: patient partial stored as one transient value, finals appended without stable ID; assistant output IDs already support updates. Keep streaming audio and replay machinery.
- `src/client/components/PrototypeLogPanel.tsx`: uncontrolled details and scrolling ol; add scoped scroll-to-bottom on opening/update.
- `src/server/reception/service.ts`: offers use appointmentLabels; lookup/select/results return raw startsAtUtc. Project derived labels at response/snapshot boundary so cached durable results refresh relative dates too; never persist derived presentation dates as booking truth.
- `src/shared/receptionPrompt.ts`: natural Hejazi persona/functions; add concise non-scripted role/name/pronunciation guidance.
- `tests/client/reception-session.test.ts`, `reception-App.test.tsx`, `App.test.tsx`: controller/UI tests. `tests/server/reception-service.test.ts`, `reception-runtime.test.ts`: disposable database/fresh session integration. Inspect existing live scripts before use; real API costs are authorized for focused testing, never mutate user's bookings.

## Tasks & Acceptance

**Execution:**
- [x] Reproduce missing-final-marker consecutive captions, immediate streaming bubbles, fresh-session Saudi lookup and log-open scroll with failing tests before implementation.
- [x] Fix controller transcript lifecycle and diagnostics, stable patient UI updates, scoped log scroll and consistent server date projection.
- [x] Improve natural receptionist guidance; run Arabic and English live text conversations including first-name-only and fresh-session saved appointment lookup. Use disposable DB and existing harness where possible; inspect real persisted effects, not speech alone.
- [x] Update `docs/decision-log.md`, `docs/reception-replacement.md` and concise relevant AGENTS pitfalls explaining coverage gaps and what changed.

**Acceptance Criteria:**
- Given several caller/assistant turns, when final transcription flags are absent or captions arrive late, then previous bubbles remain and updates target the correct turn without changing consent ordering.
- Given a saved appointment and a fresh session, when lookup/select/recovery return it, then spoken labels use Saudi local time and storage/version remain unchanged.
- Given long logs, when opened, then the newest event is visible without page scroll.
- Given offline and live verification, when reporting completion, then distinguish deterministic fixes, observed semantic speech and unverified microphone/accent quality.

## Implementation Notes

User requested all fixes together. Existing untracked baseline is intentional and must remain unstaged. Loose initiative follows the existing replacement work. This is a targeted regression repair, not a new architecture or planning workflow.

## Plan Change Log

## Review Triage Log

- Quick review finding 1 — high, patch: verified `turnComplete` removes the caption owner after a non-final prefix, so a following suffix is dropped or attached to a new input. Preserve a bounded post-completion owner until new activity; add a regression for the actual boundary, not just generationComplete.
- Quick review finding 2 — medium, patch: verified completed empty owners survive later onsets and confidently consume the next caption. Retire completed owners at new activity. Provider captions lack original turn IDs; log ambiguous/orphan fragments as uncertain and retain visible text without manufacturing consent turns. The prior late-caption fixture assumed FIFO causality unavailable from real provider events and must characterize this uncertainty honestly.

Both findings patched with failing-then-passing regressions. Parent inspected final controller behavior: one caption owner survives completion but is retired at the next onset; unmatched fragments use display-only IDs and cannot affect command sequencing. No actionable review finding deferred. Provider ambiguity and speech-quality limits remain explicitly documented rather than claimed solved.

## Verification

- Review correction verification: `npm test -- tests/client/reception-session.test.ts tests/client/reception-App.test.tsx` — 40 tests passed across two targeted files. Three new regressions plus the revised cross-onset fixture first failed for the reviewed defects. The full run recorded below predates these corrections; fresh full verification is pending. A single caption owner survives completion only until the next caller onset, and display-only orphan captions remain uncertain without changing activity/consent carriers.

- `npm test` — new regression cases plus existing suite green.
- `npm run build` — typecheck and production build pass.
- Focused real Gemini Arabic/English text-to-audio runs with isolated DB; correlate function facts and saved appointment results. Do not claim pronunciation fixed without listening.

2026-10-03 execution evidence:

- Six initial regressions failed for the observed missing-marker/FIFO, progressive-output, stable-input-UI, log-scroll and raw-UTC result defects; audio-only and partial-caption post-turnComplete regressions also failed before their repairs. New tool activity starts a distinct response instead of reusing a completed output's ID.
- Fresh full `npm test`: 607 tests passed across 52 files. Fresh `npm run build`: TypeScript and Vite production build passed. A further failing regression protects an output continuing through tool activity before its final late caption.
- `npx tsx scripts/smoke-reception.ts --regressions --rounds=1`: Arabic final report `output/reception-live/2026-10-03T03-07-24-086Z-ar-known/report.json`; `--english`: English report `output/reception-live/2026-10-03T03-04-54-492Z-en-known/report.json`. Both stored exactly the supplied first name (أحمد/Ahmed), saved 2026-10-04T06:00:00.000Z, spoke 4 October 9 AM after a distinct fresh-session lookup, preserved lookup storage, and completed cancellation/current-session farewell closure with zero scenario failures.
- Retained failures: initial English connection timed out before any tool/effect (`2026-10-03T03-02-27-042Z-en-known`); one Arabic repeat transliterated أحمد to Ahmed and failed the exact-name assertion (`2026-10-03T03-05-11-622Z-ar-known`). This prompted original-script guidance in the tool/system instructions. The later Arabic run accepted and stored أحمد. Final editorial shortening retains that guidance; model behavior is still stochastic.
- Speech limits: English still requested a full name in its observed run before accepting Ahmed; Arabic sometimes used gendered address despite neutral guidance. Guidance mitigates these tendencies without enforcing dialogue. Generated audio was saved but not perceptually assessed. Actual microphone ASR, Hejazi accent, pronunciation and voice consistency remain unverified and need interactive retesting.

- Parent final verification after review patches: `npm test` 610/610, 52 files, exit 0; `npm run build` typecheck and Vite exit 0. Chrome log opening measured a bottom gap of less than one pixel. Persistent demo booking remains active, version 1, `2026-10-04T06:00:00Z` (09:00 Riyadh); isolated live fixtures did not mutate it. Scoped diff reviewed against pre-change source copies because the prototype baseline is untracked/dirty. No staging/commit/push, preserving the user's checkout boundary.
