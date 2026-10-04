# Persistent prototype test log

## Goal

Add a small, collapsible in-app log that helps the project owner diagnose prototype conversations across refreshes and tab closures.

## Approved scope

- Persist a bounded log in this browser's `localStorage`.
- Capture timestamps, final patient/agent transcript text, whether patient text came from microphone or the text test composer, session state, tool names and result statuses, output-verification failures, and playback failures.
- Add controls to copy the log and clear it.
- Keep logging local to the browser; do not record audio, API credentials, tool arguments, or complete tool/database results.
- Do not change agent conversation behavior or the transcript bubbles.

## Implementation steps

1. Add unit tests for log loading, appending, retention bounds, formatting, malformed storage, and clearing.
2. Implement the safe local log store and collapsible accessible panel.
3. Wire app transcript/state/audio callbacks and session tool outcomes into the log, excluding sensitive payloads.
4. Add integration tests for logging, copy/clear, and persistence across app remounts.
5. Run the focused tests, full test suite, typecheck, and production build.

## Verification

- `npm test` — 21 test files and 223 tests passed.
- `npm run build` — TypeScript check and Vite production build passed.
