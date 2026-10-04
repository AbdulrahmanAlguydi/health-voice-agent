# Conversation Turn Retention and Recovery Implementation Plan

> **For agentic workers:** Use test-driven development: add each regression test, run it to confirm the expected failure, then make the smallest implementation change.

**Goal:** Preserve every patient turn in the visible session transcript, prevent the agent from looping on an invalid identity-denial reply, and make scripted Arabic sound consistently conversational and professional in a Saudi register.

**Architecture:** Treat `inputTranscription` as the completed speech transcript even when the optional SDK `finished` property is absent; keep each completed conversation entry in session state. Track whether an identity denial is valid for the latest completed identity challenge and consume that allowance once. Keep all factual fields and returned database content unchanged while editing only application-authored Arabic phrasing.

**Tech Stack:** React, TypeScript, Gemini Live SDK, SQLite service response strings, Vitest, Testing Library.

## Global Constraints

- Every spoken turn after the opening must exactly match either an application function response or an approved fixed phrase.
- Patient and doctor facts, specialties, locations, spoken languages, and availability come only from patient input or the prototype database.
- The database is authoritative for fixed records and availability; patient input is authoritative for current intent and preferences.
- Arabic patient-facing replies use polite, neutral Saudi Arabic; English replies remain warm, clear, and professional.
- Do not diagnose, triage, recommend doctors, or give treatment or emergency advice.

---

### Task 1: Retain completed patient turns

**Files:**
- Modify: `src/client/voice/session.ts`
- Modify: `src/client/App.tsx`
- Test: `tests/client/live-session.test.ts`
- Test: `tests/client/App.test.tsx`

- [ ] Add a session regression test that starts a microphone turn and sends `inputTranscription: { text: "My ID is 123" }` without `finished`; expect one finalized patient transcript and a finalized current turn.
- [ ] Run `npm test -- tests/client/live-session.test.ts` and verify that test fails because the transcript is currently treated as interim.
- [ ] Make the smallest change so text in the final `inputTranscription` field is finalized even when `finished` is omitted.
- [ ] Add an app regression test that appends more than 100 patient and assistant entries and verifies the oldest patient entry remains present.
- [ ] Run `npm test -- tests/client/App.test.tsx` and verify it fails because `appendMessage` currently truncates history.
- [ ] Remove the arbitrary history slice while retaining stable IDs and the existing partial-transcript behavior.
- [ ] Run both client test files and confirm all transcript behavior passes.

### Task 2: Make identity-denial recovery stateful

**Files:**
- Modify: `src/client/agent/tools.ts`
- Test: `tests/client/agent-tools.test.ts`

- [ ] Add a test that simulates a successful patient lookup, completed name read-back, and a non-affirmative patient transcript; assert the first `identity_denied` call returns the identity-denial copy.
- [ ] In that test, call `identity_denied` again without a new patient lookup; assert it returns the patient-ID request copy instead of repeating the denial.
- [ ] Run `npm test -- tests/client/agent-tools.test.ts` and verify the repeated-denial assertion fails against the current stateless handler.
- [ ] Track one identity-denial allowance per completed patient challenge; reset it on a new lookup and consume it on the first valid denial reply.
- [ ] Run the focused test and the complete agent-tool test file.

### Task 3: Align spoken Arabic with the requested tone

**Files:**
- Modify: `src/shared/safeReplyCopy.ts`
- Modify: `src/server/services/bookingService.ts`
- Modify: `src/server/services/directoryService.ts`
- Modify: `src/server/services/doctorService.ts`
- Modify: `src/server/services/patientService.ts`
- Modify: `src/server/services/slotService.ts`
- Modify: `src/client/agent/tools.ts`
- Modify: `src/client/voice/session.ts`
- Test: existing matching client and server Arabic response tests.
- [ ] Update application-authored Arabic prompts and service response wrappers to concise, conversational Saudi phrasing, including the direct ID request `اعطيني رقم المريض عشان أشيك عليه.`
- [ ] Keep all doctor/patient names, specialties, locations, languages, slot dates, booking references, and statuses as the exact values returned from the database.
- [ ] Update only existing exact-string expectations that cover changed patient-facing wording.
- [ ] Run affected client/server tests, then `npm test`, `npm run typecheck`, and `npm run build`.
