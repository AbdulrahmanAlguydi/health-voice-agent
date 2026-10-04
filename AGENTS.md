<!-- bmad:context -->
# Project context

Verified 2026-10-03 against replacement code in the dirty working tree based on `ceab68c356bcf24146b4a43d58d34ab3b142ae7e`; the revision alone does not include all current files.

## Orientation and policy

This is a local, synthetic-data Arabic/English hospital receptionist prototype, not telephony or a production patient system. The user delegates routine architecture and implementation decisions. Preserve unrelated edits; do not ask again about settled choices or add production infrastructure without a concrete need.

Use BMAD architecture/build/project-context for architectural decisions, meaningful changes and refreshing these instructions. Do not duplicate the same work in OpenSpec or another planning workflow. Use focused debugging/TDD/verification where needed. Keep plans proportional to the prototype.

## Where things are

- `docs/health-voice-agent-design.md`: product decisions and replacement-workflow target. Distinguish planned behavior from running code.
- `_bmad-output/reception-contracts.md` and `architecture-alternatives/architecture-alternatives.md`: replacement ownership and contracts. Read when changing booking, recovery or component ownership. `architecture-prototype/` describes legacy fixtures.
- `src/client/voice/receptionSession.ts`: active thin Gemini transport, stable input/output IDs, media exposure and recovery; `voice/audio.ts`: streaming queue. `session.ts` and `agent/tools.ts` are explicit legacy fixtures.
- `src/server/reception/`: active persistent sessions/contact/drafts/offers/operations, synthetic appointments/capacity/effects and typed routes. `src/shared/reception*.ts`: replacement contracts/contact/prompt. `bookingService.ts` and `server/db/` remain legacy fixtures/catalog source.
- `tests/`: offline regression suite. `scripts/`: inspect a script before using it; some use the real API or mutate demo bookings. `docs/decision-log.md`: rationale/history, not mandatory reading for every small edit.

## Running and verification

Use package scripts for dev, tests, typechecking and build. Offline tests use disposable databases; passing them does not verify microphone recognition, Saudi accent, voice consistency or live latency. For a conversation regression, correlate transcript/tool diagnostics with actual database results instead of trusting spoken success. Never print `.env` values or credentials. Never run `db:reset` without an explicit reset request.

## Conventions and known pitfalls

- Keep Gemini Live and free-form natural Arabic/English speech. Do not restore prerecorded lines, a second output-verification model or strict sentence matching to fix conversation failures.
- Doctor/availability facts must come from database tools. Only a confirmed service result proves booking success.
- Booking result persistence belongs to the same transaction as the appointment/slot/guest write. Retry the same approved operation after a lost response; do not discard its handle or create a new booking while the outcome is unknown.
- A transport disconnect is not cancellation. Restore the persisted server snapshot for reconnect; explicit Stop fences the domain and page reload starts a distinct browser session. Replacement drafts survive server restart.
- The default browser has no intake/readback or output-verification gate. Assert semantic state, event ordering and database effects; retain old gate tests only as explicit legacy fixtures.
- Token constraints bind authoritative reception snapshot context. Reconnect uses the same server session and bounded retries; old response snapshots cannot lower its revision. Unresolved writes block routine mutations, while emergency pause/UI Stop may fence admission and retain the unknown handle.
- Caller contact is session metadata and persists across explicit household subjects; subject/appointment IDs and approvals remain separate. Audio completed/interrupted without actual started exposure is not presentation.
- Derive dates from server time in Asia/Riyadh. Update schema additively and preserve existing demo data.
- Live transcription can omit `finished` or trail generation/turn completion. Test consecutive microphone onsets and stable bubble IDs, not only finished-caption fixtures; raw caption diagnostics label activity and never create consent turns. Refresh appointment/offer labels at response and restored-snapshot boundaries, including durable recovered results; UTC storage remains authoritative.
- Vite must ignore BMAD runtime/staging/output folders: on Windows its watcher previously blocked official BMAD setup's directory rename.
- Keep this file short and code-verified; update it when a new recurring failure or architectural decision makes it stale.
<!-- /bmad:context -->
