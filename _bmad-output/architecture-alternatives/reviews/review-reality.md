# Architecture alternatives reality review

Reviewed 2026-10-02 against `architecture-alternatives.md`, `comparison.md`, the referenced replacement design, current source and primary provider documentation. Verdict: **pass for architecture selection, not implementation readiness**. No blocking reality/version/capability finding. The recommendation is an engineering judgment with explicit acceptance tests, not a benchmark or a claim of deployed behavior.

## Provider and framework reality

- The direct-browser versus server-relay claim is supported: Google documents both and describes a general streaming-performance benefit from bypassing a backend hop. The comparison correctly avoids claiming measured app latency. Google also recommends ephemeral credentials for direct client use; the current app has server-issued Live tokens. [Google Live overview](https://ai.google.dev/gemini-api/docs/live-api).
- Manual function response handling and synchronous baseline are documented. The tool page's matrix names Gemini 3.1/2.5 while its examples use `gemini-3.8-live`; the asynchronous section explicitly excludes 3.1. This does not establish asynchronous support for this app's exact model/token configuration. The proposed probe and fallback are appropriate. [Google Live tools](https://ai.google.dev/gemini-api/docs/live-api/tools).
- Provider session resumption is a documented feature requiring configuration, retained update handles and a later connection using that handle. The design correctly makes exact-configuration support conditional and retains application-context reconstruction as its baseline; it does not claim current implementation. [Google session management](https://ai.google.dev/gemini-api/docs/live-api/session-management).
- LiveKit's documented starting pattern is one agent with a small tool set, adding other workflow constructs for concrete limitations. Its framework also supports realtime media lifecycle and STT/LLM/TTS pipelines. Choosing not to migrate yet is the authors' application-specific judgment, not a universal vendor recommendation. [LiveKit workflows](https://docs.livekit.io/agents/logic/workflows/), [LiveKit framework overview](https://docs.livekit.io/agents/).
- The Google web console README confirms streaming playback, microphone capture and logging modules, labels the project an experiment rather than an official product, and contains `@google/generative-ai`/`gemini-2.0-flash-exp` examples. Narrow reference reuse with SDK compatibility checks is justified. “Google-maintained” must not be interpreted as an availability/support guarantee. [Google web console README](https://github.com/google-gemini/live-api-web-console).

No framework migration, package upgrade, provider capability probe or live voice comparison occurred in this review. The architecture introduces no fixed version assertion requiring dependency installation.

## Current implementation versus target

| Concern | Source reality | Target status |
| --- | --- | --- |
| Stack/media | React/TypeScript, Express, `better-sqlite3`, `@google/genai`; client uses direct `ai.live.connect` | Retaining this stack is accurate; backend relay/LiveKit remain alternatives |
| Speech | One configured voice, Arabic/English, generic Saudi delivery prompt; normal controller does not inject a second verifier | Urban Hejazi is a selected future register, not an achieved accent claim |
| Playback | `guardrails.ts` accumulates audio and waits for generation and transcript completion even in delivery-only mode | Streaming chunks without whole-turn withholding is a real proposed change |
| Intake/approval | `tools.ts` owns client identity, summary, availability and transcript approval flags; server draft is an in-memory map | Durable server resources, offer/subject/contact revisions and thin transport are not implemented |
| Commit recovery | `BookingService.confirm()` saves appointment/slot/guest/result atomically and retrieves `booking_results` by pending ID | Preserve this invariant; payload/version binding and other action types are new work |
| Lifecycle | Controller reconnect reconstructs local context; no provider resumption-handle configuration, persistent session envelope or reload recovery | Authoritative fetch, serialized end and bounded unknown recovery are proposed |
| Appointment management | Current routes prepare/confirm/cancel a pending draft; schema has permanently unique `appointments.slot_id` | Move/cancel booked appointment/history and unique active occupancy require new schema/services |
| Catalogs/effects | Seed contains 30 doctors and 10 specialties; no persistent contact chunks, offers, policy/service catalogs, waitlist or simulated notification tables | Those are explicit replacement scope, not current features |

Source inspected: `package.json`, `src/shared/geminiLiveConfig.ts`, `src/client/voice/session.ts`, `src/client/agent/guardrails.ts`, `src/client/agent/tools.ts`, `src/server/services/bookingService.ts`, `src/server/services/geminiTokenService.ts`, `src/server/routes/bookings.ts`, `src/server/app.ts`, `src/server/db/schema.sql`, `src/server/db/seed.ts` and AGENTS.md.

## Limits that remain correctly explicit

The documents do not promise semantic consent correctness, reliable accent from a prompt, better Arabic from STT/TTS, exact async capability, real SMS/telephony, production clinical validity, or runtime migration/backups already performed. The 24-hour policy is explicitly synthetic. Capacity, revisions, replay without tool invocation and serialized end still need concrete contracts and tests before implementation. Existing offline results cannot validate the selected architecture's new resources or urban Hejazi listening quality.

No runtime or design files were changed. No regression run was necessary for this design-only source/document review; this report makes no new runtime passing claim.
