# Arabic-Default Language Policy — Design

Status: User-directed behavior documented; awaiting user review before implementation planning.

## Goal

Make Arabic the predictable default language while allowing callers to speak English naturally, without an opening language-selection question. The agent supports only Arabic and English in conversation.

## Chosen approach

Use Gemini Live speech-to-speech with an Arabic-only opening, Arabic/English transcription hints where supported, and system instructions that restrict assistant responses to Arabic or English. The agent begins in Arabic, follows a clearly English utterance in English, and switches back when the caller clearly speaks Arabic. This retains the existing low-latency voice architecture and avoids asking every caller to choose a language.

The transcription hints improve the likelihood that incoming speech is interpreted as Arabic or English, but they are not a hard language lock. Google documents Live API `languageCodes` as BCP-47 hints and says native audio models can switch languages; system instructions can restrict the languages the model speaks. Therefore, this prototype can constrain conversation behavior and output, but cannot guarantee the recognizer will never transcribe a third language. A separate language-constrained STT component would offer a stronger input boundary but would add another service and change the selected architecture; it is not recommended for this prototype.

## Conversation policy

- Opening: say only “السلام عليكم، أهلًا بك. كيف أقدر أساعدك اليوم؟” Do not ask which language the caller prefers.
- Start in Arabic. Follow a clearly English utterance in English and a clearly Arabic utterance in Arabic. An explicit request to switch languages may also change the response language.
- Do not switch because an Arabic utterance contains an English doctor name, ID, numeral, or borrowed term. For mixed or ambiguous speech, stay in the current language and ask one focused repair question.
- Arabic and English are the only supported conversation languages. When an utterance appears to use another language or is not understood, respond with fixed repair wording in the current language (Arabic by default) asking the caller to repeat in Arabic or English. Do not answer in or translate from an unsupported language, and do not proceed to patient, doctor, or booking tools from that unclear turn.
- Apply the same rule to text used for testing. Preserve the previously selected warm professional English style and clear conversational Saudi-Arabic style.
- Repair corrections remain within Arabic and English; do not restart the conversation or repeat questions already answered.

## Configuration and guardrail boundary

- Set Live input transcription `languageCodes` to Arabic and English BCP-47 hints where the active Gemini Live model accepts them; verify the exact configuration with a live smoke test.
- Keep the system prompt explicit about Arabic-first behavior, clear turn-level language switching, and refusing other languages.
- Use app-authored localized repair copy for unsupported or unclear language; all generated audio must continue through the existing exact-output gate.
- Do not claim that the prompt or transcription hints hard-disable third-language recognition. If a future requirement demands strict ASR-level rejection, revisit the STT-to-agent-to-TTS architecture separately.

## Acceptance criteria

- The first assistant utterance is the approved Arabic greeting only; it does not ask the caller to choose a language.
- Arabic speech receives Arabic replies; a clearly English utterance receives English replies; the agent can switch back to Arabic.
- An English doctor name or ID inside an otherwise Arabic request does not switch the response language.
- Mixed or ambiguous input gets a focused repair in the current language.
- A third-language utterance receives an Arabic-or-English repeat request, with no unsupported-language answer or domain tool call in scripted scenarios.
- Text and voice exercise the same language policy, and existing exact-output safety checks remain active.
- Live testing documents that `languageCodes` are a best-effort hint, not proof that the model cannot recognize other languages.

## Testing expectations

- Unit-test the approved Arabic opening, language policy prompt, and localized repair copy.
- Test language behavior with representative Arabic, English, mixed proper-name, and unsupported-language turns.
- Include live voice checks because unit tests cannot establish actual Gemini language detection or Saudi-Arabic naturalness.

## References

- Google documents supported Live API languages and that spoken output languages can be restricted with system instructions: [Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities).
- The Live API reference describes transcription `languageCodes` as optional BCP-47 hints, with automatic detection when omitted or empty: [Live API reference](https://ai.google.dev/api/live).
