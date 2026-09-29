# Gemini Live Integration Design

Status: Approved direction; written-spec review pending.

This addendum records the provider-specific design for the bilingual hospital appointment prototype. The living product requirements remain in [`docs/health-voice-agent-design.md`](../../health-voice-agent-design.md). This document supersedes the OpenAI-specific Realtime integration described in the existing implementation plan.

## Goals and non-goals

Use Gemini 3.8 Live as the only conversational model for English and Arabic voice and text interactions. Preserve the agreed product scope: synthetic patient and doctor data, factual directory answers, patient-selected appointment booking, local persistence, and strong application guardrails. The app is a monitored prototype, not a production patient service.

There are no real telephone calls, hospital systems, real patient records, diagnoses, treatment advice, or doctor recommendations. Google Search and model-memory facts are not enabled as directory sources.

## Selected architecture

Use a browser-to-Gemini Live connection provisioned by the Express application:

1. The browser asks the app server for a short-lived Gemini Live token.
2. The server uses its private Gemini Developer API key to create a single-use token constrained to `gemini-3.8-live` and the approved session configuration. The standard API key never reaches browser code.
3. The browser connects directly to Live API with the short-lived token using the Google GenAI JavaScript SDK. Microphone audio goes to Gemini; Live API returns audio chunks and their input/output transcriptions.
4. Gemini function calls are handled explicitly by the browser SDK callback. Each handler calls a narrow, validated Express route; it does not import or access SQLite. The browser sends the server result back to Gemini as a function response.
5. Express owns all database reads, alias resolution, booking state, validation, and persistent writes. The model has no SQL access or direct database write capability.

The Gemini function declarations are part of the constrained Live session config. Every data-dependent function uses blocking behavior, so the model waits for the server result before generating the next answer. Only these application functions are configured: patient lookup, doctor search/details, available-slot search, booking preparation, booking confirmation, and pending-booking cancellation. Ending the session is a local UI action, not a server or database function.

The browser connection is selected for the prototype’s low latency and modest implementation scope. A backend WebSocket proxy would give the server tighter control of the entire audio stream but adds transport code and latency. A cascaded transcription/reasoning/TTS system could emit native text-only replies, but adds models and risks inconsistent voice; it conflicts with the agreed single-model design.

## Text and audio behavior

Gemini 3.8 Live’s supported response modality is audio. Enable Live API input and output audio transcriptions. Text typed in the web app is sent into the same Live session; the generated output transcript is displayed as the agent’s text reply. Audio playback is optional and can be muted for typed testing. In that muted path Gemini still generates audio, which the browser discards; there is no separate text model and no claim that this is a native text-only response mode.

Microphone input is streamed to the same session. The user’s speech transcription is shown in the live transcript, while generated speech and its transcript supply the agent reply. Arabic turns render right-to-left; English turns render left-to-right. The opening is bilingual, after which the agent follows the patient’s language until asked to switch.

Use one fixed prebuilt voice for both languages. Choose the voice after listening to the same English and Arabic receptionist samples in the browser; do not assume a voice sounds naturally Saudi without Arabic-speaker feedback. The Arabic style is clear, conversational, and politely Saudi, while remaining broadly intelligible. The English style is warm, concise, and professional.

## Guardrails and booking integrity

Prompt instructions are only one layer. Tool routes validate every field independently, accept allowlisted structured filters, resolve explicit Arabic/English aliases to canonical IDs, and return only approved directory or patient fields. No untrusted patient claim can alter stored facts. No Google Search tool is configured.

Fact-bearing tool results include localized response text derived from returned database fields. The model is instructed to render this text without adding facts. The client buffers all assistant audio for a turn until the turn is complete and its output transcript has passed the deterministic checks for required factual text, disallowed medical advice or recommendations, stale evidence, and contradictions. On interruption, failed check, missing transcript, or timeout, the buffer is discarded. A short in-scope fallback may be requested from the same model and must pass the gate before playback; otherwise the UI shows an approved text fallback and plays no rejected audio.

Booking requires a valid synthetic patient, a patient-selected doctor and exact available slot, a server-created short-lived confirmation bound to those values, and an unambiguous affirmative in the completed current patient transcript after read-back. The confirmation route validates the affirmative, consumes the confirmation once, rechecks availability, and performs the persistent write transactionally. Corrections, declines, ambiguous/partial transcripts, timeout, or session end cancel the pending confirmation. The app reports a booking only after the write succeeds.

The audio-output gate runs in browser code in this low-latency prototype; browser-side checks are not a security boundary against a person deliberately modifying the client. The Express booking and data invariants remain authoritative for ordinary app use. Do not use this architecture with real patient data or treat it as a zero-risk clinical service.

## Failure handling and operational limits

- If token creation, Live connection, microphone permission, or a tool request fails, show a clear recoverable state; do not claim a lookup or booking succeeded.
- If the current transcript is incomplete or output safety checks cannot complete, fail closed: do not play generated audio and do not confirm a booking.
- On interruption, immediately discard queued audio and return to listening.
- Close only after the safe closing audio finishes, or when the patient stops/ends the session; allow restart without reloading the page.
- Keep the API key in a local server `.env` file excluded from version control. Live testing requires a user-provided Gemini Developer API key; never request that they paste it in chat.
- Gemini ephemeral tokens are documented as Preview. Use short expiry and one use, constrain the model and session config, and test token issuance/connection against the actual account before relying on it.
- The Gemini 3.8 model documentation says blocking function calls are available and async is the default; declare database functions as blocking. Google’s Live API tool overview table does not yet list Gemini 3.8, although its model page and tool examples do. Treat a real function-call smoke test as a required integration check.
- Buffering until a full transcript passes adds latency. Measure it during manual voice checks without weakening the safety gate.
- Output transcript checks reduce risk but cannot prove semantic grounding for every free-form utterance. Keep factual responses tightly tied to server-authored text, test adversarial scenarios, and require monitored demos.

## Verification

Offline tests must cover server schemas, database constraints, bilingual alias resolution, database authority over contradictory claims, transaction/persistence/reset behavior, single-use confirmation, output guardrails in English and Arabic, complete-turn audio buffering, interruption discard, text input and transcript display, muting, restart, and failures that fail closed. Mock Gemini in automated tests; tests must not require an API key.

With a local Gemini API key, smoke-test the exact `gemini-3.8-live` model, locked token configuration, input/output transcription events, blocking tool calls, function responses, and audio turn boundaries. Then manually test typed English and Arabic booking, voice Arabic booking, guardrail attacks, unclear input recovery, correction/decline/end, and persistent availability after server restart/reset. Arabic-speaker listening is required before claiming Saudi voice quality is verified.

## Official references

- [Gemini 3.8 Live model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live) — model ID, supported output modality, and blocking function-call option.
- [Tool use with Live API](https://ai.google.dev/gemini-api/docs/live-api/tools) — explicit client handling of function calls and responses.
- [Ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens) — short-lived constrained browser credentials and Preview status.
- [Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities) — audio input/output, text input, transcription, voice config, and interruption events.
- [Live API best practices](https://ai.google.dev/gemini-api/docs/live-api/best-practices) — concise system instructions, language behavior, and stream handling.
