# Bilingual Hospital Appointment Voice Agent — Prototype Design

Status: Living design document and primary source of truth for the prototype.

## Goal

Build a small web prototype that feels like a warm, capable hospital receptionist. Patients can ask factual questions about doctors and book available appointments by speaking or typing. The prototype is for demonstrating the agent’s conversation quality and guardrails; it does not connect to a hospital or handle real patient data.

## Agreed product scope

- A simple web app, not a visual phone-call simulator.
- Voice input and spoken replies, live transcript, and optional text input for easier testing. Text and speech use the same conversation flow.
- A brief bilingual opening invites the patient to choose Arabic or English. The agent follows the patient’s language and stays with it unless asked to switch.
- Arabic responses use polite, neutral Saudi Arabic. English responses use a warm, clear, professional receptionist style.
- The prototype does not disclose that the agent is AI, per the prototype requirement.
- Patients can provide an existing mock patient ID. The agent looks it up and confirms a matching record; no second verification step is in scope.
- Patients can ask about or search for doctors using facts present in the directory. The agent does not recommend doctors or infer which doctor is medically suitable.
- The agent helps book a doctor and time selected by the patient, subject to the stored schedule.
- The agent can close the conversation after completing the request, when the patient declines to book, or when the patient says they are done. The web app ends the voice session after the spoken closing and can offer a fresh session afterward.

## Prototype data

Use synthetic data only:

- 30 doctors across 10 specialties.
- Explicit English and Arabic doctor names, specialty names, and authored aliases, each tied to a stable canonical ID.
- The approved doctor directory fields are name and aliases, specialty, clinic location, languages spoken, and appointment availability. Do not include biographies, credentials, ratings, or other facts unless they are explicitly added to the mock dataset.
- A small set of synthetic patient profiles keyed by mock patient ID.
- A seeded set of upcoming appointment slots with varied availability so the demo can show both successful and unavailable requests.
- Persistent appointments created during prototype use.

## Data grounding and guardrails

The agent’s factual claims about patients, doctors, specialties, locations, languages, and schedules must come from either the patient’s current input or a successful result from the prototype data store. The agent must not use general model knowledge or web search to fill in missing directory or patient facts.

The data store is authoritative for fixed records and availability. The patient is authoritative for current intent and preferences, such as which doctor and appointment time they want. If the patient claims a stored doctor or slot fact is different, the agent explains what the directory or schedule currently shows and offers supported alternatives. It does not silently change doctor, specialty, or schedule records.

The agent may request searches through narrow, structured filters, such as a doctor name, canonical specialty, language, or location. The application validates allowed fields and performs the lookup. The model cannot send raw SQL or arbitrary database commands. Arabic and English aliases resolve to canonical IDs in application logic. If a name maps to multiple doctors, the agent asks the patient to clarify; if no record matches, it says so without guessing.

Booking is the only patient-related change in scope. The agent must have a valid patient record, a specific doctor, and a specific slot. It reads back the doctor, date, and time and waits for the patient’s confirmation. The application then checks availability again and writes the appointment and slot status together. It reports success only after the persistent write succeeds. The model cannot directly modify records.

The agent stays within directory lookup and appointment booking. It does not diagnose, give treatment advice, or recommend a doctor. For out-of-scope medical questions, it briefly explains that it can help with doctor information and appointments, then offers to continue with those tasks. Attempts to override the database or the agent’s role do not change tool permissions or stored facts.

## Persistent prototype storage

Use a small local persistent data store (SQLite is suitable) for the seeded synthetic records and prototype bookings. Confirmed bookings and their slot status must survive page reloads and application restarts, so later sessions see the updated availability.

Provide a development-only reset operation that removes prototype bookings and restores the original seeded slot availability. Keep reset controls out of the patient conversation. The entire local store can also be removed when the prototype is retired. No real hospital database, phone system, or patient data is connected.

## Conversation behavior

The interaction should feel concise and attentive rather than scripted:

1. Give the short bilingual welcome and follow the patient’s chosen language.
2. Ask for the patient ID if it is not already available; look it up and confirm the matching patient record.
3. Understand whether the patient wants directory information or to book an appointment.
4. For directory questions, search only approved stored fields and answer from returned records.
5. For booking, clarify the requested doctor and date or time as needed, check stored availability, and offer exact available choices.
6. Repeat the selected doctor, date, and time and ask for confirmation before the booking write.
7. Report the persistent booking result, then close naturally if the patient is finished. If the patient declines or asks to end at any point, acknowledge that and close without booking.

Ask one useful question at a time. Keep replies brief, vary acknowledgements naturally, and avoid repeating information the patient already provided. The patient can interrupt spoken replies. For unclear input, ask about the specific uncertain detail rather than restarting the entire conversation. After repeated failures to understand, close politely and let the patient start a new session; do not guess or claim a human handoff exists.

## Demo and guardrail scenarios

The seeded data and scripted test conversations should cover:

- A complete English booking and a complete Arabic booking using Arabic doctor or specialty aliases.
- A factual doctor lookup, including clinic location, spoken languages, or specialty.
- Two similar doctor names that require clarification, plus an unknown doctor or specialty that returns no match.
- A patient claiming a doctor is available at a time that the data store marks unavailable.
- An unavailable requested slot followed by a booking of an offered available slot.
- Invalid or unclear patient ID, unclear speech, correction of a misheard name or time, and repeated no-match recovery.
- A patient who declines to book or asks to end the session.
- Requests for diagnosis or doctor recommendations, and instructions to ignore the database or invent facts; the agent stays within its scope and uses only supported data.
- Persistence: after a confirmed booking, refresh or restart the app and verify the same slot remains booked; use the development reset to restore seed availability.

## Acceptance criteria

- Both voice and text can complete the same lookup and booking flows; speech input is transcribed and agent replies are spoken and shown in the transcript.
- Arabic and English doctor/specialty names and aliases resolve to the intended canonical records; ambiguous matches trigger a clarification.
- No doctor, specialty, patient, clinic, or availability fact is asserted unless supported by the mock data or the patient’s current input.
- A booking cannot be recorded without a valid patient ID, a currently available slot, and the patient’s explicit confirmation of the selected details.
- Confirmed bookings remain after page reload and application restart; reset restores the seeded demo state.
- The agent does not recommend doctors or provide diagnosis or treatment advice, and it closes gracefully when the patient is done.
- Arabic and English voice samples are reviewed for clarity and naturalness; the specific Saudi Arabic phrasing and voice quality need listening feedback from Arabic speakers.

## Research notes

- OpenAI Realtime supports speech-to-speech sessions, text inputs and outputs, and application-executed function tools: [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations), [Realtime tools](https://developers.openai.com/api/docs/guides/realtime-mcp).
- OpenAI recommends structured fields, application-side checks, and guardrails to limit the effect of untrusted input on tool calls: [Safety in building agents](https://developers.openai.com/api/docs/guides/agent-builder-safety).
- Google’s voice-agent guidance supports focused repair questions, brief turns, and a natural closing flow: [Voice agent design best practices](https://docs.cloud.google.com/dialogflow/cx/docs/concept/voice-agent-design).
- HL7 FHIR notes that an available slot does not guarantee a booking, supporting an availability recheck when the booking is written: [FHIR Appointment](https://hl7.org/fhir/R5/appointment.html).
- Rasa documents mapping recognized aliases to normalized entity values, a useful model for bilingual aliases resolving to canonical IDs: [NLU training data: synonyms](https://legacy-docs-oss.rasa.com/docs/rasa/2.x/nlu-training-data/).
