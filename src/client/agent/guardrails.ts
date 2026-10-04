import { normalizeTextForMatching } from "../../shared/textNormalization";
import { SAFE_REPLY_COPY } from "../../shared/safeReplyCopy";
import { canonicalizeSpeech, isNaturalReceptionDialogue, matchesDirectoryEvidence, removeGroundedPhrases, type DirectorySpeechEvidence } from "./speechPolicy";
import { OutputVerificationVerdictSchema, type OutputVerifier } from "../../shared/outputVerification";
import { containsConcreteOutput, type OutputVerificationPolicy } from "./outputVerificationPolicy";

export type OutputAudioChunk = { data: string; mimeType: string };

export type OutputGateRejectionReason =
  | "booking_status_mismatch"
  | "evidence_mismatch"
  | "disallowed_content"
  | "interrupted"
  | "timeout"
  | "missing_audio"
  | "verification_unavailable";
// A provider outage is distinct from an unsafe model response.

export type ApprovedOutput = {
  transcript: string;
  audio: OutputAudioChunk[];
  language: "en" | "ar";
  conversational?: boolean;
  verification?: "not_required" | "semantic" | "local" | "trusted";
};

type ActiveOutput = {
  expectedText?: string;
  language: "en" | "ar";
  allowNaturalVariation: boolean;
  policy: OutputVerificationPolicy;
  directoryEvidence?: DirectorySpeechEvidence;
  audio: OutputAudioChunk[];
  transcriptParts: string[];
  transcriptFinished: boolean;
  generationComplete: boolean;
  timeout: ReturnType<typeof setTimeout>;
  verification?: AbortController;
};

type OutputGateOptions = {
  /** Production prototype: buffer media only; grounding belongs to tools/prompt. */
  deliveryOnly?: boolean;
  timeoutMs?: number;
  verify?: OutputVerifier;
  verificationKind?: "semantic" | "local";
  onApproved?: (output: ApprovedOutput) => void;
  onRejected?: (event: { reason: OutputGateRejectionReason; transcript?: string; safeText?: string }) => void;
};

const disallowedClinicalContent = [
  "diagnosis", "diagnoses", "diagnose", "treatment", "treatments", "prescribe", "prescription", "prescriptions", "medication", "medications", "medicine", "medicines", "drug", "drugs",
  "emergency", "emergencies", "recommend", "recommends", "recommended", "recommendation", "recommendations", "you should see", "you may have", "likely have", "symptom", "symptoms", "disease", "diseases",
  "تشخيص", "التشخيص", "علاج", "العلاج", "دواء", "الدواء", "ادوية", "الأدوية", "وصفة", "الوصفة", "طوارئ", "الطوارئ", "انصحك", "اوصي", "الافضل لك", "مرض", "المرض", "اعراض", "الاعراض",
];

const contextFreeSafeReplyKeys = [
  "clarify_request",
  "ask_doctor",
  "ask_day",
  "ask_one_thing_at_a_time",
  "repeat_request",
  "acknowledge",
  "repeat_unavailable",
] as const;

function includesAny(normalized: string, phrases: string[]) {
  const padded = ` ${normalized} `;
  return phrases.some((phrase) => padded.includes(` ${normalizeTextForMatching(phrase)} `));
}

function safeLanguage(language: string | undefined): "en" | "ar" {
  return language === "ar" ? "ar" : "en";
}

const approvedOpeners: Record<"en" | "ar", string[]> = {
  en: ["of course", "sure", "okay", "sorry"],
  ar: ["اكيد", "تمام", "طيب", "معليش"],
};

function matchesApprovedSpeech(
  transcript: string,
  expectedText: string,
  language: "en" | "ar",
  allowNaturalVariation: boolean,
): boolean {
  // A narrow output-transcription repair for the greeting, never facts or digits.
  const normalizedTranscript = normalizeTextForMatching(transcript).replace(/^اللسلام عليكم(?= |$)/, "السلام عليكم");
  const normalizedExpected = normalizeTextForMatching(expectedText);
  if (normalizedTranscript === normalizedExpected) return true;
  if (!allowNaturalVariation) return false;

  const comparableTranscript = canonicalizeSpeech(transcript, language);
  const comparableExpected = canonicalizeSpeech(expectedText, language);
  if (comparableTranscript === comparableExpected) return true;

  // Allow exactly one short, non-factual opener before the otherwise unchanged reply.
  const openers = approvedOpeners[language]
    .map(normalizeTextForMatching)
    .sort((left, right) => right.length - left.length);
  if (openers.some((candidate) => comparableExpected === candidate || comparableExpected.startsWith(`${candidate} `))) {
    return false;
  }
  const opener = openers.find((candidate) => comparableTranscript.startsWith(`${candidate} `));
  return opener !== undefined && comparableTranscript.slice(opener.length + 1) === comparableExpected;
}

/** Holds every audio chunk until the complete output transcript and audio turn pass the checks. */
export class AssistantOutputGate {
  private readonly deliveryOnly: boolean;
  private readonly timeoutMs: number;
  private readonly onApproved?: (output: ApprovedOutput) => void;
  private readonly onRejected?: (event: { reason: OutputGateRejectionReason; transcript?: string; safeText?: string }) => void;
  private active?: ActiveOutput;
  private readonly verify?: OutputVerifier;
  private readonly verificationKind: "semantic" | "local";

  constructor(options: OutputGateOptions = {}) {
    this.deliveryOnly = options.deliveryOnly ?? false;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.onApproved = options.onApproved;
    this.onRejected = options.onRejected;
    this.verify = options.verify;
    this.verificationKind = options.verificationKind ?? "semantic";
  }

  begin(expectedText?: string, language?: string, allowNaturalVariation = true, directoryEvidence?: DirectorySpeechEvidence, policy: OutputVerificationPolicy = "required"): void {
    this.discardActive();
    const active: ActiveOutput = {
      expectedText: expectedText?.trim() || undefined,
      language: safeLanguage(language),
      allowNaturalVariation,
      policy,
      directoryEvidence,
      audio: [],
      transcriptParts: [],
      transcriptFinished: false,
      generationComplete: false,
      timeout: setTimeout(() => this.reject("timeout"), this.timeoutMs),
    };
    this.active = active;
  }

  addAudio(chunk: OutputAudioChunk): void {
    if (!this.active || !chunk.data || !chunk.mimeType.startsWith("audio/pcm")) return;
    this.active.audio.push({ data: chunk.data, mimeType: chunk.mimeType });
    this.tryApprove();
  }

  updateConversationLanguage(language: "en" | "ar"): void {
    if (this.active && !this.active.expectedText) this.active.language = language;
  }

  updateReceptionEvidence(evidence: DirectorySpeechEvidence): void {
    // Final ASR can establish initial slot consent after the microphone turn
    // opened. Refresh only conversational intake, never a factual readback.
    if (this.active?.policy === "conversation" && !this.active.expectedText && !this.active.verification && evidence.receptionIntent) {
      this.active.directoryEvidence = evidence;
    }
  }

  addTranscript(text: string, finished = false): void {
    if (!this.active || this.active.transcriptFinished || !text) return;
    this.active.transcriptParts.push(text);
    if (finished) this.active.transcriptFinished = true;
    this.tryApprove();
  }

  markGenerationComplete(): void {
    if (!this.active) return;
    this.active.generationComplete = true;
    // Live can omit outputTranscription.finished; generationComplete follows the final transcript chunk.
    if (this.active.transcriptParts.length > 0) this.active.transcriptFinished = true;
    this.tryApprove();
  }

  interrupt(): void {
    this.reject("interrupted");
  }

  /** Discards the current model generation when a tool-call boundary starts. */
  discard(): void {
    this.discardActive();
  }

  private tryApprove(): void {
    const active = this.active;
    if (!active || active.verification || !active.generationComplete || !active.transcriptFinished) return;
    const transcript = active.transcriptParts.join("").trim();
    if (active.audio.length === 0) {
      this.reject("missing_audio", transcript);
      return;
    }
    if (this.deliveryOnly) {
      clearTimeout(active.timeout);
      this.active = undefined;
      this.onApproved?.({ transcript, audio: active.audio, language: active.language, verification: "not_required" });
      return;
    }
    if (active.policy === "conversation" && !containsConcreteOutput(transcript, active.directoryEvidence)) {
      clearTimeout(active.timeout);
      this.active = undefined;
      this.onApproved?.({ transcript, audio: active.audio, language: active.language, conversational: true, verification: "not_required" });
      return;
    }
    const isApprovedExpectedResponse = active.expectedText !== undefined && matchesApprovedSpeech(
      transcript, active.expectedText, active.language, active.allowNaturalVariation,
    );
    if (this.verify && !isApprovedExpectedResponse && active.allowNaturalVariation) {
      clearTimeout(active.timeout);
      const abort = new AbortController();
      active.verification = abort;
      active.timeout = setTimeout(() => { if (this.active === active) this.reject("timeout"); }, 12000);
      void this.verify({ transcript, language: active.language, expectedText: active.expectedText, evidence: active.directoryEvidence }, abort.signal)
        .then((result) => {
          if (this.active !== active || abort.signal.aborted) return;
          const verdict = OutputVerificationVerdictSchema.parse(result);
          if (!verdict.approved) { this.reject("evidence_mismatch", transcript); return; }
          clearTimeout(active.timeout);
          this.active = undefined;
          this.onApproved?.({ transcript, audio: active.audio, language: active.language, conversational: verdict.conversational, verification: this.verificationKind });
        }).catch(() => { if (this.active === active && !abort.signal.aborted) this.reject("verification_unavailable", transcript); });
      return;
    }
    const ungroundedWords = removeGroundedPhrases(transcript, active.directoryEvidence, active.language);
    if (!isApprovedExpectedResponse && includesAny(ungroundedWords, disallowedClinicalContent)) {
      this.reject("disallowed_content", transcript);
      return;
    }
    // Identity, times and booking read-backs remain exact. Directory wording can
    // vary around the returned fields; ordinary reception talk has no DB facts.
    const isContextFreeSafeReply = active.expectedText === undefined && contextFreeSafeReplyKeys.some((key) =>
      matchesApprovedSpeech(
        transcript,
        SAFE_REPLY_COPY[active.language][key],
        active.language,
        active.allowNaturalVariation,
      ),
    );
    const hasConversationExpectation = active.expectedText === undefined || contextFreeSafeReplyKeys.some((key) =>
      normalizeTextForMatching(active.expectedText ?? "") === normalizeTextForMatching(SAFE_REPLY_COPY[active.language][key]));
    const isNaturalDialogue = active.allowNaturalVariation && hasConversationExpectation && isNaturalReceptionDialogue(transcript, active.language);
    const isGroundedDirectoryReply = active.allowNaturalVariation && active.directoryEvidence !== undefined &&
      matchesDirectoryEvidence(transcript, active.directoryEvidence, active.language);
    if (!isApprovedExpectedResponse && !isContextFreeSafeReply && !isNaturalDialogue && !isGroundedDirectoryReply) {
      this.reject("evidence_mismatch", transcript);
      return;
    }

    clearTimeout(active.timeout);
    this.active = undefined;
    this.onApproved?.({ transcript, audio: active.audio, language: active.language, verification: isApprovedExpectedResponse ? "trusted" : undefined });
  }

  private reject(reason: OutputGateRejectionReason, transcript?: string): void {
    const active = this.active;
    if (!active) return;
    clearTimeout(active.timeout);
    active.verification?.abort();
    this.active = undefined;
    this.onRejected?.({ reason, transcript: transcript ?? active.transcriptParts.join("").trim(), safeText: active.expectedText });
  }

  private discardActive(): void {
    if (!this.active) return;
    clearTimeout(this.active.timeout);
    this.active.verification?.abort();
    this.active = undefined;
  }
}
