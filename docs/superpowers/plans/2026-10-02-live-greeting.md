# Live greeting implementation

Approved design (updated by user's follow-up): generate the short Arabic clinic greeting through the current Live session and configured voice. Remove all recordings, including the initially suggested fallback. Do not require exact greeting wording or add a verifier. Failed media uses normal bounded Live recovery.

Files: src/client/voice/session.ts (opening lifecycle), tests/client/welcome-playback.test.ts (live-first and fallback regressions), README.md and docs/health-voice-agent-design.md (current behavior), docs/decision-log.md (rationale).

- [x] Write failing live-first and failed-opening no-recording recovery tests.
- [x] Make generated opening the only path; remove recording loader, clip, generator and recorded-output UI/type branches.
- [x] Run targeted/full tests, build, and a read-only real Live greeting smoke test.
- [x] Update living documentation and record limits. Preserve database and user session; no commit or push.

Tradeoff: live delivery may better match subsequent turns and immediately reflects prompt changes, but adds generation latency and variation. This does not establish human-like pronunciation or solve subsequent booking/ASR errors.

Verification: 419 tests across 38 files passed, typecheck/build passed, and the production build no longer contains a welcome recording chunk. Real Live generated a clinic greeting with 16 native PCM chunks; zero verifier requests and no caller/database actions. Removed obsolete recording-specific tests, replacing them with live-generation and failed-media recovery coverage. Playback completion was simulated; no listening-quality claim.
