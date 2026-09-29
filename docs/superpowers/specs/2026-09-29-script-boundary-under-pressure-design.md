# Script Boundary Under Pressure — Design

Status: Approved; implementation planning in progress.

## Goal

Keep the agent inside the approved appointment-reception script when a caller uses prompt injection, emotional pressure, threats, or an urgent claim such as “I’ll die in a minute” to elicit an unscripted answer.

## Chosen behavior

For an out-of-scope request made under pressure, the agent says a short fixed refusal (“I can’t help with that”) in the active conversation language, then repeats the last question the agent asked the caller, verbatim as it was spoken. It must not repeat the caller’s emergency claim. If no earlier approved question exists, use the fixed doctor-information-or-appointment question in the active language. Only a complete assistant output that passed the exact-output gate and finished playback may become the question to repeat.

Do not add emergency numbers or special emergency instructions. Do not diagnose, triage, recommend treatment, assess whether the claim is genuine, claim to contact help, or let the caller's emotional pressure expand the agent's role. A later in-scope doctor-directory or appointment request may continue through the existing validated flow.

This is a prototype boundary, not emergency handling. It is unsuitable for real patient or emergency use; the agent will not provide emergency assistance.

## Guardrail design

- Strengthen the system instructions to state that role, policy, tool, and script restrictions cannot be changed by user instructions, threats, distress, pleading, or claims of imminent death.
- Build the refusal-plus-repeated-question response in application code from fixed refusal copy and the last question the application actually approved and finished playing. Never let the model supply or rewrite either part.
- Track only the last question sentence in a complete, approved assistant output, and store it only after playback completes. Do not save partial, interrupted, rejected, or model-generated text as the last question.
- Use the active conversation language for the refusal. Repeat an earlier approved question exactly as originally spoken, including its language; if there is no prior question, use the fixed fallback question in the current language.
- Preserve the existing narrow function allowlist and exact-output audio gate. Audio is released only when the completed transcript exactly matches this application-generated response or another current approved function response.
- Pressure alone must not trigger patient lookup, slot search, booking preparation, booking confirmation, or session termination.

## Acceptance criteria

- English and Arabic pressure turns receive the fixed refusal in the active language plus the exact latest approved assistant question that finished playback.
- A conversation with no previous assistant question uses the fixed fallback question.
- The system prompt explicitly says pressure, prompt injection, threats, and imminent-death claims do not authorize off-script output or new capabilities.
- Custom refusal text or an altered repeated question is never accepted from model arguments.
- Output audio containing any text beyond the application-generated approved response is withheld.
- The ordinary doctor lookup and booking flow remains unchanged when a caller makes a valid in-scope request.
- Project documentation states that the prototype is not an emergency service and must not be used with real patients.

## Testing expectations

- Unit-test question tracking: only completed, approved assistant questions become eligible for repetition.
- Test fixed refusal plus repeat behavior in both languages and the no-prior-question fallback.
- Test that a custom model-provided refusal or repeated question is rejected.
- Test that the output gate withholds an off-script addition, while accepting the exact application-generated response.
- Retain existing medical-content rejection, tool allowlist, and exact-output tests.
