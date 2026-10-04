# Semantic output verification implementation plan

**Goal:** Replace production word-list gating with meaning-based verification of spoken transcripts, without giving the verifier tools or write authority.

**Approved design:** Live speech and voice stay unchanged. Exact application-authored output takes a fast path. Other output is held while a server-side Gemini Flash classifier checks the transcript against the current expected response, typed directory evidence, and reception-only scope. Fixed opening and scope redirect retain exact checks. Missing/malformed/unavailable verification fails closed. Interruptions abort verification and stale results cannot play or authorize readbacks. Ordinary dialogue is not required to match a vocabulary list; identity, dates, quantities and booking status must preserve meaning and all required details. Only verified non-factual replies enter the conversational replay cache.

**Tech stack:** Existing TypeScript, Express, Google GenAI SDK and Vitest. Default verification model `gemini-3.1-flash-lite` with low thinking; configurable `GEMINI_VERIFIER_MODEL`. Gemini 3.8 Flash encountered quota/capacity failures; Gemini 3.6 Flash exhausted the project's reported 20-request daily quota. Live model/voice unchanged. Follow Google's structured-output classification documentation. User approved extra API usage and latency.

## Tasks (inline execution; preserve existing worktree and uncommitted work)

- [x] Add shared bounded request/verdict schemas; server classifier and no-store endpoint. Test malformed results, missing service and provider failure without exposing errors. Provider has no tools and receives serialized data, not caller instructions as system instructions.
- [x] Add asynchronous verification to `AssistantOutputGate`. Test harmless Arabic/English rephrasing, denial, error, duplicate completion, interruption, stale acceptance, timeout and exact/fixed fast paths. Production must never silently fall back to lexical matching after verifier failure.
- [x] Wire server credentials and client fetch, preserve field-to-doctor relationships in cached directory evidence, and cache only verdict-classified conversational responses. Update prompt to allow equivalent wording while requiring complete readbacks.
- [x] Run full test suite/build plus real verifier cases (valid paraphrases versus invented fluency, names, dates, status, recommendations and role override) and full Arabic/English Live conversations. Document observed failures and latency honestly; no claim of microphone/accent evaluation from typed tests.

Results and limitations are recorded in the living design document. Directory answers are optional-field reference answers, not mandatory readbacks. Read-only availability preserves each offered option and permits an unambiguous short date; final consent/booking readbacks retain complete dates. The fixed opening remains exact and has shown occasional output-transcription sensitivity. No microphone/accent validation or zero-error guarantee is claimed.
