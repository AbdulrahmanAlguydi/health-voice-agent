# Guest Patient Appointment Booking — Design

Status: Design approved; awaiting user review before implementation planning.

## Goal

Allow a caller without an existing patient record to book a doctor-selected, database-available appointment. Keep the existing patient-ID flow for registered callers.

## Chosen approach

After the caller agrees to a specific available slot, the agent asks for only a full name and mobile number. It then reads back the name, number, doctor, date, and time and asks for a final confirmation. Only a clear final confirmation commits the booking and creates a synthetic patient profile. This avoids persisting unused profiles and lets the caller correct a transcription error before data is saved.

Alternative approaches considered:

- Create a patient profile as soon as name and mobile are collected. This can leave a profile behind if the caller changes their mind or the slot becomes unavailable.
- Book anonymously under a shared placeholder profile. This omits the requested caller details and makes appointment ownership ambiguous.

## Conversation and data flow

1. Preserve the current flow for registered callers: look up the supplied patient ID, read back the database name, and require the existing explicit identity confirmation.
2. If a caller says they are not registered or cannot provide an ID, offer the guest path. Do not block directory questions or slot searches on patient registration, and do not ask for guest details before the caller agrees to a specific appointment.
3. Search doctors and availability using the existing fixed application functions. The database remains authoritative for doctors, schedules, and availability.
4. After the caller agrees to the selected slot, collect their full name and mobile number. Ask a targeted repair question if either is unclear; do not guess or infer either value.
5. Prepare a pending guest booking through a narrowly scoped application function. The pending item holds the caller-provided details and selected doctor/slot in server memory; it does not write a patient or appointment record.
6. Return an application-authored read-back containing the supplied name and mobile plus the exact doctor and slot. The existing output gate must approve its transcript and audio. Only a fresh, unambiguous affirmation after that read-back may commit.
7. On commit, recheck slot availability and atomically create the synthetic patient profile, mark the slot booked, and create the appointment. Generate a unique mock patient ID server-side; do not ask the guest to provide one. Reuse the existing booking reference and success response behavior.

The registered and guest paths share the slot lookup and confirmation safeguards, but only the registered path requires a prior patient-ID identity confirmation. The guest path does not weaken the registered path.

## Persistence and failure behavior

- Store guest full name exactly as the caller provided it; do not transliterate or invent a second-language version. For compatibility with the existing localized-name fields, use the same original name in both fields.
- Store the mobile number with the guest profile. It is caller-provided prototype data and is not verified by SMS or an external hospital system.
- Create the guest profile and appointment only in the final-confirmation transaction. If the caller corrects details, declines, ends the session, or the slot fails the final availability recheck, do not save a guest profile or appointment.
- On an unavailable slot, report the database result and offer current alternatives. The caller must select and confirm a new slot.
- Existing seeded patient records and their patient-ID flow remain unchanged.
- Apply an idempotent schema migration for the mobile field so existing persistent SQLite files continue to open.

## Scope and guardrails

- Guest data is limited to full name and mobile number; do not request date of birth, insurance, symptoms, or other medical details.
- Do not collect any guest details until the caller has agreed to a specific available slot.
- The model may not generate database IDs, SQL, or booking outcomes. The server creates IDs and performs validated writes.
- Caller input supplies guest name/mobile and appointment intent. The database supplies doctor facts, slot details, and booking status.
- No real calls, SMS verification, external hospital integration, or account credentials are introduced.

## Acceptance criteria

- A caller who says they are not registered can browse the doctor directory and available slots without a patient ID.
- The agent asks for full name and mobile only after the caller agrees to a specific slot.
- The name and number are read back with the selected appointment and require a fresh final affirmative.
- Successful confirmation atomically creates one guest profile and one appointment, and marks the selected slot booked.
- Cancellation, end-of-session, invalid details, or slot unavailability does not persist a guest profile or appointment.
- Registered callers continue to use the current patient-ID lookup, name read-back, identity confirmation, and booking flow.
- The flow works in English and Arabic and preserves caller-provided guest name text without automatic translation.

## Testing expectations

- Unit-test guest request validation and the model-to-application function allowlist.
- Test the full guest prepare/cancel and prepare/confirm routes against a persistent SQLite fixture.
- Verify rollback/no-write behavior on a declined confirmation and unavailable slot.
- Reopen the SQLite file after a successful guest booking and confirm the patient, mobile number, appointment, and slot status persist.
- Keep existing registered-patient booking and identity-confirmation tests passing.
