import type {
  LiveCallbacks,
  LiveConnectConfig,
  LiveServerMessage,
} from "@google/genai";
import { extractLastQuestion } from "../../shared/lastInquiry";
import { normalizeSimulatedCallingNumber } from "../../shared/simulatedCallingNumber";
import { GEMINI_LIVE_MODEL, GEMINI_OPENING_TEXT, createGeminiLiveConfig } from "../../shared/geminiLiveConfig";
import { AssistantOutputGate, type ApprovedOutput, type OutputGateRejectionReason } from "../agent/guardrails";
import { contradictsBookingStatus } from "../agent/bookingStatus";
import { createAgentToolHandler, type AgentFunctionResponse, type AgentToolHandler } from "../agent/tools";
import { TurnCoordinator } from "../agent/turnCoordinator";
import { createAvailabilitySpeechEvidence, createBookingSpeechEvidence, createDirectorySpeechEvidence, isNaturalReceptionDialogue } from "../agent/speechPolicy";
import { detectConversationLanguage } from "./language";
import { type OutputVerifier } from "../../shared/outputVerification";
import { diagnosticDetails, type SessionDiagnostic } from "../logging/sessionDiagnostic";
import { toolOutputVerificationPolicy } from "../agent/outputVerificationPolicy";

export type LiveSessionPort = {
  sendRealtimeInput: (params: { text?: string; audio?: { data: string; mimeType: string }; audioStreamEnd?: boolean }) => void;
  sendClientContent: (params: { turns: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>; turnComplete?: boolean }) => void;
  sendToolResponse: (params: { functionResponses: AgentFunctionResponse[] }) => void;
  close: () => void;
};

export type LiveConnectFunction = (
  token: string,
  model: string,
  config: LiveConnectConfig,
  callbacks: LiveCallbacks,
) => Promise<LiveSessionPort>;

export type AgentSessionState = "idle" | "connecting" | "connected" | "listening" | "speaking" | "ended" | "error";

export type SessionToolResultEvent = { toolName: string; status: string };

export type SessionControllerCallbacks = {
  onDiagnostic?: (event: SessionDiagnostic) => void;
  onState?: (state: AgentSessionState, message?: string) => void;
  onPatientTranscript?: (text: string, final: boolean, source: "microphone" | "text", inputTurnId?: string) => void;
  onToolResult?: (event: SessionToolResultEvent) => void;
  onAssistantTranscript?: (text: string, language: "en" | "ar", isFallback?: boolean, outputId?: string) => void;
  onStreamStart?: (outputId: string, onStarted: () => void, onFinished: () => void, onFailed: () => void) => void;
  onStreamChunk?: (outputId: string, chunk: { data: string; mimeType: string }) => void;
  onStreamEnd?: (outputId: string) => void;
  onRecordedOutput?: (outputId: string, output: import("./receptionSession").RecordedOutput) => void;
  onApprovedOutput?: (
    output: ApprovedOutput,
    onPlaybackComplete: () => void,
    onPlaybackFailure: () => void,
  ) => void;
  onOutputRejected?: (event: { reason: OutputGateRejectionReason; transcript?: string; safeText?: string; retrying?: boolean }) => void;
  onStopPlayback?: () => void;
  onError?: (message: string) => void;
};

export interface SessionControllerApi {
  connect(options?: { simulatedCallingNumber?: string }): Promise<void>;
  beginMicrophoneTurn(): number;
  sendMicrophoneAudio(base64Pcm16: string): void;
  endMicrophoneStream(): void;
  sendText(text: string): boolean;
  stop(notify?: boolean): Promise<void>;
}

export type GeminiLiveSessionOptions = SessionControllerCallbacks & {
  fetch?: typeof globalThis.fetch;
  connectLive?: LiveConnectFunction;
  verifyOutput?: OutputVerifier;
};

type TokenResponse = { token?: unknown; model?: unknown; voiceName?: unknown; expiresAt?: unknown };

async function defaultLiveConnect(
  token: string,
  model: string,
  config: LiveConnectConfig,
  callbacks: LiveCallbacks,
): Promise<LiveSessionPort> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: token, apiVersion: "v1beta" });
  return ai.live.connect({ model, config, callbacks });
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

const BATCH_SAFE_READS = new Set(["list_specialties", "search_doctors", "get_doctor_details"]);

function visibleToolResult(result: AgentFunctionResponse): AgentFunctionResponse {
  const response = { ...result.response };
  if (response.speechIntent) delete response.responseText;
  delete response.pendingId;
  delete response.patientId;
  delete response.guestSlotId;
  delete response.availabilityReadbackPending;
  delete response.repeatSource;
  for (const key of ["patient", "appointment"]) {
    const nested = response[key];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const visible = { ...nested as Record<string, unknown> };
    delete visible.patientId;
    response[key] = visible;
  }
  return { ...result, response };
}

export class GeminiLiveSessionController implements SessionControllerApi {
  readonly turns = new TurnCoordinator();
  private readonly fetcher: typeof globalThis.fetch;
  private readonly connectLive: LiveConnectFunction;
  private readonly callbacks: SessionControllerCallbacks;
  private readonly toolHandler: AgentToolHandler;
  private readonly outputGate: AssistantOutputGate;
  private liveSession?: LiveSessionPort;
  private state: AgentSessionState = "idle";
  private currentLanguage: "en" | "ar" = "ar";
  private assistantAudioPlaying = false;
  private inputTurnPending = false;
  private closeAfterPlayback = false;
  private stopping = false;
  // Only delivery permissions live here; the tool handler owns the booking.
  private readonly delivery = {
    pendingReadbackId: undefined as string | undefined,
    currentAvailabilityReadbackPending: false,
    currentGuestConsentPromptSlotId: undefined as string | undefined,
    currentOutputReadbackId: undefined as string | undefined,
    currentIdentityReadbackId: undefined as string | undefined,
  };
  private lastApprovedQuestion?: string;
  private lastConversationalReply?: { text: string; language: "ar" | "en" };
  private lastDirectoryEvidence?: { evidence: ReturnType<typeof createDirectorySpeechEvidence>; language: "ar" | "en" };
  private directoryEvidenceHistory: Array<{ evidence: NonNullable<ReturnType<typeof createDirectorySpeechEvidence>>; language: "ar" | "en" }> = [];
  private intakeIntent?: "request_patient_id" | "request_guest_name" | "request_guest_mobile";
  private connectionAttempt = 0;
  private modelTurnComplete = false;
  private automaticRepeatAttempted = false;
  private internalRepeatPending = false;
  private pendingAutomaticRepeat?: { reason: OutputGateRejectionReason; safeText?: string };
  private pendingRepeatTimeout?: ReturnType<typeof setTimeout>;
  private sessionId = "not-connected";
  private playbackSequence = 0;
  private turnStartedAt = 0;
  private audioChunkCount = 0;

  constructor(options: GeminiLiveSessionOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.connectLive = options.connectLive ?? defaultLiveConnect;
    this.callbacks = options;
    this.toolHandler = createAgentToolHandler({
      fetch: this.fetcher,
      turns: this.turns,
      getLastApprovedQuestion: () => this.lastApprovedQuestion,
      onDiagnostic: (event, details, durationMs) => this.diagnostic(event, details, durationMs),
      getCurrentLanguage: () => this.currentLanguage,
      getLastConversationalReply: (language) => this.lastConversationalReply?.language === language
        ? this.lastConversationalReply.text
        : undefined,
      onEndSession: () => {
        this.closeAfterPlayback = true;
      },
    });
    this.outputGate = new AssistantOutputGate({
      // Injected checkers are retained for isolated diagnostics only. The app never
      // supplies one: native speech is not sentence-matched before playback.
      deliveryOnly: !options.verifyOutput,
      verify: options.verifyOutput,
      verificationKind: "semantic",
      onApproved: (output) => this.approveOutput(output),
      onRejected: (event) => this.rejectOutput(event),
    });
  }

  async connect(options?: { simulatedCallingNumber?: string }): Promise<void> {
    if (this.liveSession) return;
    const callingNumber = normalizeSimulatedCallingNumber(options?.simulatedCallingNumber ?? "");
    const recovery = this.toolHandler.getBookingContext();
    const resuming = Boolean(recovery.pendingId || recovery.booked || recovery.verifiedPatientId
      || recovery.pendingIdentityId || recovery.bookingIntentActive || recovery.guestPath
      || (Array.isArray(recovery.availableSlotIds) && recovery.availableSlotIds.length));
    const attempt = ++this.connectionAttempt;
    this.sessionId = globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}-${attempt}`;
    this.turnStartedAt = performance.now();
    this.audioChunkCount = 0;
    this.diagnostic("session_config", { model: GEMINI_LIVE_MODEL, speechChecks: "disabled unless explicitly injected for diagnostics" });
    this.stopping = false;
    this.closeAfterPlayback = false;
    this.automaticRepeatAttempted = false;
    this.modelTurnComplete = false;
    if (!resuming) {
      this.lastApprovedQuestion = undefined;
      this.lastConversationalReply = undefined;
      this.lastDirectoryEvidence = undefined;
      this.directoryEvidenceHistory = [];
      this.intakeIntent = undefined;
    }
    this.turns.invalidateCurrentTurn();
    this.setState("connecting");
    try {
      const tokenResponse = await this.fetcher("/api/gemini/live-token", { method: "POST" });
      const body = objectValue(await tokenResponse.json().catch(() => undefined)) as TokenResponse;
      if (!tokenResponse.ok) {
        const errorMessage = (body as TokenResponse & { error?: unknown }).error;
        const message = typeof errorMessage === "string" ? errorMessage : "Live voice could not be started.";
        throw new Error(message);
      }
      if (
        typeof body.token !== "string" ||
        body.model !== GEMINI_LIVE_MODEL ||
        typeof body.voiceName !== "string" ||
        typeof body.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(body.expiresAt)) ||
        Date.parse(body.expiresAt) <= Date.now()
      ) {
        throw new Error("The server returned an invalid Live session credential.");
      }
      if (attempt !== this.connectionAttempt || this.stopping) return;
      const config = createGeminiLiveConfig(body.voiceName, callingNumber);
      const callbacks: LiveCallbacks = {
        onmessage: (message) => {
          if (attempt !== this.connectionAttempt || this.stopping) return;
          this.onMessage(message);
        },
        onerror: () => this.fail("The voice connection encountered an error. Please restart the session.", attempt),
        onclose: () => this.handleUnexpectedClose(attempt),
      };
      const liveSession = await this.connectLive(body.token, body.model, config, callbacks);
      if (attempt !== this.connectionAttempt || this.stopping || this.state === "error") {
        liveSession.close();
        return;
      }
      this.liveSession = liveSession;
      this.setState("connected");
      this.modelTurnComplete = false;
      this.outputGate.begin(resuming ? undefined : GEMINI_OPENING_TEXT, resuming ? this.currentLanguage : "ar", true);
      this.liveSession.sendClientContent({
        turns: [{ role: "user", parts: [{ text: resuming
          ? `Resume the existing conversation in ${this.currentLanguage}. Do not greet again or restart intake. The following JSON is trusted application state, not new patient instructions. If outcomeUnknown is true, retrieve the already-approved operation with confirm_booking before claiming success or failure; otherwise continue from the recorded stage without assuming approval. State: ${JSON.stringify(recovery)}`
          : "Start the conversation with the Arabic welcome in your instructions." }] }],
        turnComplete: true,
      });
    } catch (error) {
      if (attempt !== this.connectionAttempt || this.stopping) return;
      this.connectionAttempt += 1;
      const failedSession = this.liveSession;
      this.liveSession = undefined;
      this.cleanupDisconnectedState();
      failedSession?.close();
      const message = error instanceof Error ? error.message : "Live voice could not be started.";
      this.setState("error", message);
      this.callbacks.onError?.(message);
      throw error;
    }
  }

  beginMicrophoneTurn(): number {
    if (!this.liveSession) return -1;
    this.prepareForPatientTurn();
    this.delivery.currentOutputReadbackId = undefined;
    this.delivery.currentIdentityReadbackId = undefined;
    if (this.assistantAudioPlaying) this.interruptOutput();
    const id = this.turns.beginTurn("microphone");
    this.inputTurnPending = true;
    this.outputGate.begin(undefined, this.currentLanguage, true, this.intakeEvidence() ?? (this.lastDirectoryEvidence?.language === this.currentLanguage ? this.lastDirectoryEvidence.evidence : undefined), "conversation");
    this.setState("listening");
    return id;
  }

  sendMicrophoneAudio(base64Pcm16: string): void {
    if (!this.liveSession || !base64Pcm16) return;
    this.liveSession.sendRealtimeInput({
      audio: { data: base64Pcm16, mimeType: "audio/pcm;rate=16000" },
    });
  }

  endMicrophoneStream(): void {
    this.liveSession?.sendRealtimeInput({ audioStreamEnd: true });
  }

  sendText(text: string): boolean {
    const trimmed = text.trim();
    if (!this.liveSession || !trimmed || trimmed.length > 400) return false;
    this.prepareForPatientTurn();
    this.delivery.currentOutputReadbackId = undefined;
    this.delivery.currentIdentityReadbackId = undefined;
    if (this.assistantAudioPlaying) this.interruptOutput();
    this.currentLanguage = detectConversationLanguage(trimmed, this.currentLanguage);
    this.turns.beginTypedTurn(trimmed);
    this.diagnostic("input_final", { text: trimmed, source: "text" });
    this.inputTurnPending = true;
    this.outputGate.begin(undefined, this.currentLanguage, true, this.intakeEvidence() ?? (this.lastDirectoryEvidence?.language === this.currentLanguage ? this.lastDirectoryEvidence.evidence : undefined), "conversation");
    this.callbacks.onPatientTranscript?.(trimmed, true, "text");
    this.setState("listening");
    this.liveSession.sendClientContent({
      turns: [{ role: "user", parts: [{ text: trimmed }] }],
      turnComplete: true,
    });
    return true;
  }

  async stop(notify = true): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.connectionAttempt += 1;
    if (this.pendingRepeatTimeout) clearTimeout(this.pendingRepeatTimeout);
    this.pendingRepeatTimeout = undefined;
    this.pendingAutomaticRepeat = undefined;
    this.internalRepeatPending = false;
    this.outputGate.discard();
    this.playbackSequence += 1;
    this.turns.invalidateCurrentTurn();
    this.callbacks.onStopPlayback?.();
    await this.toolHandler.cancelPending(this.currentLanguage);
    const session = this.liveSession;
    this.liveSession = undefined;
    session?.close();
    this.assistantAudioPlaying = false;
    this.closeAfterPlayback = false;
    this.delivery.pendingReadbackId = undefined;
    this.delivery.currentOutputReadbackId = undefined;
    this.delivery.currentIdentityReadbackId = undefined;
    this.delivery.currentAvailabilityReadbackPending = false;
    this.delivery.currentGuestConsentPromptSlotId = undefined;
    this.inputTurnPending = false;
    if (notify) this.setState("ended");
    else this.state = "ended";
  }

  private onMessage(message: LiveServerMessage): void {
    const content = message.serverContent;
    if (content) {
      if (content.interrupted) {
        this.interruptOutput();
      }

      this.observeInputTranscription(content.interimInputTranscription?.text, false);
      if (content.inputTranscription?.text) {
        // Live exposes unfinished speech separately as interimInputTranscription.
        // Presence in inputTranscription marks the completed utterance; `finished`
        // is optional in the SDK payload and must not be required to retain a turn.
        this.observeInputTranscription(content.inputTranscription.text, true);
      }

      for (const part of content.modelTurn?.parts ?? []) {
        const audio = part.inlineData;
        if (audio?.data && audio.mimeType?.startsWith("audio/pcm")) {
          this.audioChunkCount += 1;
          if (this.audioChunkCount === 1) this.diagnostic("first_output_audio", { mimeType: audio.mimeType }, performance.now() - this.turnStartedAt);
          this.outputGate.addAudio({ data: audio.data, mimeType: audio.mimeType });
        }
      }
      if (content.outputTranscription?.text) {
        this.diagnostic("output_transcript", { text: content.outputTranscription.text, final: content.outputTranscription.finished === true });
        this.outputGate.addTranscript(content.outputTranscription.text, content.outputTranscription.finished === true);
      }
      if (content.generationComplete) this.outputGate.markGenerationComplete();
      // turnComplete is deliberately not an audio-release signal; playback may still be expected by Live API.
      if (content.turnComplete) {
        this.modelTurnComplete = true;
        if (!this.assistantAudioPlaying && !this.closeAfterPlayback) this.setState("listening");
      }
    }

    if (message.toolCall?.functionCalls?.length) void this.handleToolCalls(message.toolCall.functionCalls);
    if (message.toolCallCancellation?.ids?.length) {
      this.interruptOutput();
    }
    if (content?.turnComplete && this.pendingAutomaticRepeat) this.requestAutomaticRepeat();
  }

  private observeInputTranscription(text: string | undefined, final: boolean): void {
    if (!text) return;
    let turn = this.turns.currentTranscript();
    if (turn?.source === "text" && this.inputTurnPending) return;
    const openMicrophoneTurn = turn?.source === "microphone" && !turn.final;
    if (!openMicrophoneTurn) {
      if (turn?.source === "microphone" && turn.final && turn.text === text.trim()) return;
      // The server transcript is also the recovery path when the local VAD misses a
      // quiet/short onset. Live inputTranscription is the authoritative user audio event.
      this.beginMicrophoneTurn();
      turn = this.turns.currentTranscript();
    }
    if (!turn || turn.source !== "microphone") return;
    this.turns.updateTranscript(text, final, turn.id);
    if (final) {
      this.currentLanguage = detectConversationLanguage(text, this.currentLanguage);
      this.outputGate.updateConversationLanguage(this.currentLanguage);
      const intake = this.intakeEvidence();
      if (intake) this.outputGate.updateReceptionEvidence(intake);
    }
    this.callbacks.onPatientTranscript?.(text, final, "microphone");
    this.diagnostic(final ? "input_final" : "input_interim", { text, source: "microphone" });
  }

  private async handleToolCalls(calls: NonNullable<LiveServerMessage["toolCall"]>["functionCalls"]): Promise<void> {
    const session = this.liveSession;
    if (!session || !calls?.length) return;
    const isInternalRepeat = this.internalRepeatPending;
    this.internalRepeatPending = false;
    this.modelTurnComplete = false;
    this.outputGate.discard();

    // Gemini documents input transcripts and model/tool events as independently
    // ordered. Use a schema-constrained language hint if the transcript is still late.
    const languageHints = new Set(calls
      .map((call) => objectValue(call.args).language)
      .filter((value): value is "en" | "ar" => value === "en" || value === "ar"));
    if (languageHints.size === 1) this.currentLanguage = [...languageHints][0]!;

    // If local VAD missed the onset, the model tool call still establishes an audio
    // turn. A later, independently ordered input transcript can then attach to it
    // instead of resetting the output verifier for the reply already being generated.
    if (!isInternalRepeat && !this.inputTurnPending && this.state === "listening") this.beginMicrophoneTurn();

    // A correction often arrives as cancel + availability in one model message.
    // Execute only this narrow repair chain, in order: no commit or identity intake.
    if (calls.length === 2 && calls[0]?.name === "cancel_pending_booking" && calls[1]?.name === "get_available_slots") {
      const cancellation = await this.performToolCall(calls[0]);
      if (this.liveSession !== session) return;
      this.reportToolResult(cancellation.name, cancellation.response.status);
      this.delivery.pendingReadbackId = undefined;
      this.delivery.currentOutputReadbackId = undefined;
      this.delivery.currentIdentityReadbackId = undefined;
      const availability = await this.performToolCall(calls[1]);
      if (this.liveSession !== session) return;
      this.reportToolResult(availability.name, availability.response.status);
      const responseText = typeof availability.response.responseText === "string" ? availability.response.responseText : undefined;
      const evidence = createAvailabilitySpeechEvidence("get_available_slots", availability.response, this.currentLanguage);
      if (evidence && typeof cancellation.response.responseText === "string") {
        evidence.sourceText = `${cancellation.response.responseText} ${evidence.sourceText}`;
      }
      this.delivery.currentAvailabilityReadbackPending = Array.isArray(availability.response.slots) || Array.isArray(availability.response.alternatives);
      this.outputGate.begin(responseText, this.currentLanguage, true, evidence, "required");
      this.modelTurnComplete = false;
      session.sendToolResponse({ functionResponses: [visibleToolResult(cancellation), visibleToolResult(availability)] });
      return;
    }

    if (calls.length === 2 && calls[0]?.name === "cancel_pending_booking" && calls[1]?.name === "end_session") {
      const cancellation = await this.performToolCall(calls[0]);
      if (this.liveSession !== session) return;
      const ending = await this.performToolCall(calls[1]);
      if (this.liveSession !== session) return;
      this.reportToolResult(cancellation.name, cancellation.response.status);
      this.reportToolResult(ending.name, ending.response.status);
      this.delivery.pendingReadbackId = undefined;
      this.delivery.currentOutputReadbackId = undefined;
      this.delivery.currentIdentityReadbackId = undefined;
      this.outputGate.begin(typeof ending.response.responseText === "string" ? ending.response.responseText : undefined, this.currentLanguage);
      session.sendToolResponse({ functionResponses: [visibleToolResult(cancellation), visibleToolResult(ending)] });
      return;
    }

    // Independent directory reads are safe to satisfy together; their approved text is
    // concatenated in call order. Never batch patient lookup or booking side effects.
    if (calls.length > 1) {
      if (calls.every((call) => call.name && BATCH_SAFE_READS.has(call.name))) {
        try {
          const results: AgentFunctionResponse[] = [];
          for (const call of calls) {
            try {
              const result = await this.performToolCall(call);
              results.push(result);
              this.reportToolResult(result.name ?? call.name, result.response.status);
            } catch {
              this.reportToolResult(call.name, "error");
              throw new Error("A read-only tool call failed.");
            }
          }
          if (this.liveSession !== session) return;
          const responseTexts = results.map(({ response }) => response.responseText);
          if (responseTexts.every((responseText): responseText is string => typeof responseText === "string")) {
            const combinedText = responseTexts.join(" ");
            const directoryReads = results.map((result, index) => createDirectorySpeechEvidence(calls[index]?.name, result.response, this.currentLanguage)).filter((evidence) => evidence !== undefined);
            for (const evidence of directoryReads) this.rememberDirectoryEvidence(evidence, this.currentLanguage);
            const combinedEvidence = directoryReads.length ? {
              sourceText: directoryReads.map((evidence) => evidence.sourceText).join(" "),
              requiredPhrases: [],
              groundedPhrases: directoryReads.flatMap((evidence) => evidence.groundedPhrases ?? []),
              records: directoryReads.flatMap((evidence) => evidence.records ?? []),
            } : undefined;
            this.delivery.currentOutputReadbackId = undefined;
            this.delivery.currentIdentityReadbackId = undefined;
            this.outputGate.begin(combinedText, this.currentLanguage, true, combinedEvidence);
            this.modelTurnComplete = false;
            session.sendToolResponse({ functionResponses: results.map(visibleToolResult) });
            return;
          }
        } catch {
          // Fall through to a short, approved recovery question.
        }
      }
      this.delivery.currentIdentityReadbackId = undefined;
      const safeReply = await this.performToolCall({
        name: "speak_safe_reply",
        args: { messageKey: "ask_one_thing_at_a_time", language: this.currentLanguage },
      });
      const responseText = typeof safeReply.response.responseText === "string"
        ? safeReply.response.responseText
        : "";
      const responses = calls.map((call) => ({
        id: call.id,
        name: call.name,
        response: {
          status: "invalid_request",
          responseText,
        },
      }));
      for (const call of calls) this.reportToolResult(call.name, "invalid_request");
      this.outputGate.begin(responseText, this.currentLanguage, true, undefined, "conversation");
      this.modelTurnComplete = false;
      session.sendToolResponse({ functionResponses: responses });
      return;
    }

    try {
      const call = calls[0];
      const result = await this.performToolCall(call);
      this.reportToolResult(result.name ?? call.name, result.response.status);
      if (this.liveSession !== session) return;
      if (call.name === "confirm_booking" || call.name === "cancel_pending_booking" || call.name === "end_session") {
        this.delivery.pendingReadbackId = undefined;
        this.delivery.currentOutputReadbackId = undefined;
      }
      const responseText = typeof result.response.responseText === "string"
        ? result.response.responseText
        : undefined;
      const language = this.currentLanguage;
      const speechIntent = objectValue(result.response.speechIntent).key;
      this.intakeIntent = ["request_patient_id", "request_guest_name", "request_guest_mobile"].includes(String(speechIntent))
        ? speechIntent as "request_patient_id" | "request_guest_name" | "request_guest_mobile" : undefined;
      this.delivery.currentOutputReadbackId = result.response.status === "pending" && typeof result.response.pendingId === "string"
        ? result.response.pendingId
        : undefined;
      if (this.delivery.currentOutputReadbackId) {
        this.delivery.pendingReadbackId = this.delivery.currentOutputReadbackId;
        // The initiating input turn is invalidated by prepare_booking. A fresh turn
        // must begin after this point to approve the later read-back.
        this.inputTurnPending = false;
      }
      const repeatedAvailabilityReadback = call.name === "repeat_last_response" && result.response.repeatSource === "get_available_slots";
      const repairedAvailability = call.name === "cancel_pending_booking" && result.response.availability
        ? objectValue(result.response.availability) : undefined;
      this.delivery.currentAvailabilityReadbackPending = (call.name === "get_available_slots" || repeatedAvailabilityReadback) &&
        (Array.isArray(result.response.slots) || Array.isArray(result.response.alternatives)) ||
        Boolean(repairedAvailability && (Array.isArray(repairedAvailability.slots) || Array.isArray(repairedAvailability.alternatives))) ||
        result.response.availabilityReadbackPending === true;
      this.delivery.currentGuestConsentPromptSlotId = call.name === "confirm_guest_slot" &&
        result.response.status === "awaiting_guest_consent" && typeof result.response.guestSlotId === "string"
        ? result.response.guestSlotId
        : call.name === "prepare_guest_booking" && result.response.status === "awaiting_guest_consent" && typeof result.response.guestSlotId === "string"
          ? result.response.guestSlotId
          : undefined;
      const patient = objectValue(result.response.patient);
      this.delivery.currentIdentityReadbackId = ((call.name === "lookup_patient" || call.name === "begin_booking") && result.response.status === "found" || result.response.status === "needs_identity_confirmation") && typeof patient.patientId === "string"
        ? patient.patientId
        : undefined;
      const evidenceTool = call.name === "repeat_last_response" && typeof result.response.repeatSource === "string"
        ? result.response.repeatSource
        : call.name;
      const directoryEvidence = createDirectorySpeechEvidence(evidenceTool, result.response, language);
      if (directoryEvidence) this.rememberDirectoryEvidence(directoryEvidence, language);
      const repairedEvidence = repairedAvailability ? createAvailabilitySpeechEvidence("get_available_slots", repairedAvailability, language) : undefined;
      if (repairedEvidence && responseText) repairedEvidence.sourceText = `${responseText} ${repairedEvidence.sourceText}`;
      this.outputGate.begin(repairedEvidence ? undefined : responseText, language, true, this.intakeEvidence() ?? repairedEvidence ?? directoryEvidence ?? createAvailabilitySpeechEvidence(evidenceTool, result.response, language) ?? createBookingSpeechEvidence(result.response), toolOutputVerificationPolicy(call.name, result.response, call.args));
      this.modelTurnComplete = false;
      session.sendToolResponse({ functionResponses: [visibleToolResult(result)] });
    } catch {
      this.reportToolResult(calls[0]?.name, "error");
      if (this.liveSession !== session) return;
      this.delivery.currentIdentityReadbackId = undefined;
      const responseText = this.currentLanguage === "ar"
        ? "ما قدرت أكمل الطلب الآن. خلّنا نحاول مرة ثانية."
        : "I couldn't complete that request just now. Let's try once more.";
      this.outputGate.begin(responseText, this.currentLanguage, true, undefined, "conversation");
      this.modelTurnComplete = false;
      session.sendToolResponse({
        functionResponses: [{
          id: calls[0]?.id,
          name: calls[0]?.name,
          response: { status: "error", responseText },
        }],
      });
    }
  }

  private rememberDirectoryEvidence(evidence: NonNullable<ReturnType<typeof createDirectorySpeechEvidence>>, language: "ar" | "en"): void {
    this.directoryEvidenceHistory = [...this.directoryEvidenceHistory, { evidence, language }].slice(-8);
    const recent = this.directoryEvidenceHistory.filter((item) => item.language === language).map((item) => item.evidence);
    this.lastDirectoryEvidence = { language, evidence: {
      sourceText: recent.map((item) => item.sourceText).join(" "),
      requiredPhrases: [],
      groundedPhrases: [...new Set(recent.flatMap((item) => item.groundedPhrases ?? item.requiredPhrases))],
      records: recent.flatMap((item) => item.records ?? []),
    } };
  }

  private intakeEvidence(): NonNullable<ReturnType<typeof createDirectorySpeechEvidence>> | undefined {
    const intent = this.intakeIntent ?? this.toolHandler.getReceptionIntent();
    return intent ? { sourceText: "Authorized conversational intake/repair; no booking has been completed by this question.", requiredPhrases: [], receptionIntent: intent } : undefined;
  }

  private reportToolResult(toolName: string | undefined, status: unknown): void {
    const safeToolName = typeof toolName === "string" && /^[a-z][a-z0-9_-]{0,63}$/i.test(toolName)
      ? toolName
      : "unknown";
    const safeStatus = typeof status === "string" && /^[a-z][a-z0-9_-]{0,39}$/i.test(status)
      ? status
      : "unknown";
    this.callbacks.onToolResult?.({ toolName: safeToolName, status: safeStatus });
  }

  private approveOutput(output: ApprovedOutput): void {
    const booking = this.toolHandler.getBookingContext();
    if (contradictsBookingStatus(output.transcript, booking.booked === true)) {
      const safeText = typeof booking.lastResponseText === "string" ? booking.lastResponseText : this.lastApprovedQuestion;
      this.rejectOutput({ reason: "booking_status_mismatch", transcript: output.transcript, safeText });
      return;
    }
    const playbackId = ++this.playbackSequence;
    this.diagnostic("output_ready", { transcript: output.transcript, audioChunks: output.audio.length, verification: output.verification }, performance.now() - this.turnStartedAt);
    this.assistantAudioPlaying = true;
    this.setState("speaking");
    this.callbacks.onAssistantTranscript?.(output.transcript, output.language);
    const approvedQuestion = extractLastQuestion(output.transcript);
    const readbackId = this.delivery.currentOutputReadbackId;
    // This web prototype displays the complete buffered summary immediately.
    // A caller can explicitly confirm it while its audio is still playing.
    // Withheld/unfinished output never reaches this presentation boundary.
    if (readbackId && this.callbacks.onAssistantTranscript) {
      this.toolHandler.markPendingSummaryPresented(readbackId);
      this.diagnostic("booking_summary_presented", { booking: this.toolHandler.getBookingContext() });
    }
    this.delivery.currentOutputReadbackId = undefined;
    const identityReadbackId = this.delivery.currentIdentityReadbackId;
    this.delivery.currentIdentityReadbackId = undefined;
    let completed = false;
    const onPlaybackComplete = () => {
      if (completed || playbackId !== this.playbackSequence) return;
      completed = true;
      this.diagnostic("playback_complete", { playbackId });
      this.assistantAudioPlaying = false;
      this.inputTurnPending = false;
      if (approvedQuestion) this.lastApprovedQuestion = approvedQuestion;
      if (output.conversational ?? isNaturalReceptionDialogue(output.transcript, output.language)) {
        this.lastConversationalReply = { text: output.transcript, language: output.language };
      }
      if (identityReadbackId) this.toolHandler.markPatientIdentityReadbackComplete(identityReadbackId);
      if (readbackId && this.delivery.pendingReadbackId === readbackId) {
        if (this.toolHandler.markPendingReadbackComplete(readbackId)) this.delivery.pendingReadbackId = undefined;
      }
      if (this.delivery.currentAvailabilityReadbackPending) {
        this.toolHandler.markAvailabilityReadbackComplete();
        this.delivery.currentAvailabilityReadbackPending = false;
      }
      if (this.delivery.currentGuestConsentPromptSlotId) {
        this.toolHandler.markGuestSlotConsentPromptReadbackComplete(this.delivery.currentGuestConsentPromptSlotId);
        this.delivery.currentGuestConsentPromptSlotId = undefined;
      }
      this.diagnostic("booking_delivery_complete", { booking: this.toolHandler.getBookingContext() });
      if (this.closeAfterPlayback) {
        void this.stop();
        return;
      }
      this.setState("listening");
    };
    const onPlaybackFailure = () => {
      if (completed || playbackId !== this.playbackSequence) return;
      completed = true;
      this.playbackSequence += 1;
      this.diagnostic("playback_failure", { playbackId, transcript: output.transcript });
      this.assistantAudioPlaying = false;
      this.inputTurnPending = false;
      this.callbacks.onStopPlayback?.();
      this.delivery.currentAvailabilityReadbackPending = false;
      this.delivery.currentGuestConsentPromptSlotId = undefined;
      this.toolHandler.cancelGuestSlotConsentPrompt();
      if (this.closeAfterPlayback) {
        void this.stop();
        return;
      }
      this.setState("listening");
    };
    if (this.callbacks.onApprovedOutput) this.callbacks.onApprovedOutput(output, onPlaybackComplete, onPlaybackFailure);
    else onPlaybackComplete();
  }

  private rejectOutput(event: { reason: OutputGateRejectionReason; transcript?: string; safeText?: string }): void {
    this.diagnostic("output_unplayed", event);
    this.playbackSequence += 1;
    this.assistantAudioPlaying = false;
    if (event.reason !== "interrupted") this.inputTurnPending = false;
    // A status-only wording repair preserves the pending delivery obligation.
    // The corrected audio still needs to deliver that same identity/slot/summary.
    if (event.reason !== "booking_status_mismatch") {
      this.delivery.currentIdentityReadbackId = undefined;
      this.delivery.currentAvailabilityReadbackPending = false;
      this.delivery.currentGuestConsentPromptSlotId = undefined;
      this.toolHandler.cancelGuestSlotConsentPrompt();
      this.delivery.currentOutputReadbackId = undefined;
    }
    this.callbacks.onStopPlayback?.();

    // Barge-in is expected, not a failed answer. Do not append a misleading
    // apology bubble or overwrite the caller's next input with repair text.
    if (event.reason === "interrupted") { this.setState("listening"); return; }

    if (
      !this.automaticRepeatAttempted &&
      this.liveSession
    ) {
      this.automaticRepeatAttempted = true;
      this.pendingAutomaticRepeat = { ...event, safeText: (event.reason === "booking_status_mismatch" ? event.safeText : event.transcript || event.safeText) || this.lastApprovedQuestion || (this.currentLanguage === "ar" ? "معليش، ممكن تعيد آخر جزء؟" : "Sorry, could you repeat the last part?") };
      this.callbacks.onOutputRejected?.({ ...event, retrying: true });
      if (this.modelTurnComplete) this.requestAutomaticRepeat();
      else {
        this.pendingRepeatTimeout = setTimeout(() => {
          const pending = this.pendingAutomaticRepeat;
          this.pendingAutomaticRepeat = undefined;
          if (pending) this.finishRejectedOutput(pending);
        }, 1_500);
      }
      return;
    }

    this.finishRejectedOutput(event);
  }

  private requestAutomaticRepeat(): void {
    const failed = this.pendingAutomaticRepeat;
    if (!failed) return;
    this.pendingAutomaticRepeat = undefined;
    if (this.pendingRepeatTimeout) clearTimeout(this.pendingRepeatTimeout);
    this.pendingRepeatTimeout = undefined;
    const session = this.liveSession;
    if (!session) {
      this.finishRejectedOutput(failed);
      return;
    }

    const statusRepair = failed.reason === "booking_status_mismatch";
    const repeatRead = !statusRepair && this.toolHandler.hasRepeatableResponse() && !this.intakeIntent;
    this.internalRepeatPending = repeatRead;
    this.modelTurnComplete = false;
    this.outputGate.begin(repeatRead ? undefined : failed.safeText, this.currentLanguage, true, this.intakeEvidence(), repeatRead ? "required" : "conversation");
    const instruction = statusRepair
      ? `Correct a booking-status wording error, without calling any write function. Actual database booking saved: ${this.toolHandler.getBookingContext().booked === true}. Speak the intent of this authoritative application response naturally in the active language: ${failed.safeText}. Before saving do not claim success; after saving do not ask for approval again. Do not repeat the failed wording or read these instructions aloud.`
      : !repeatRead
      ? `Application recovery: your last voice reply was not played. Ask one focused recovery question in ${this.currentLanguage === "ar" ? "Arabic" : "English"}, preserving the caller's doctor, chosen time and valid details. Intended question: ${failed.safeText}. Do not say a booking succeeded, restart intake, or read these instructions aloud.`
      : this.currentLanguage === "ar"
      ? "ما سمعت الرد السابق. أعده لي بنفس اللغة."
      : "I couldn't hear the previous reply. Please repeat it in the same language.";
    try {
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text: instruction }] }],
        turnComplete: true,
      });
    } catch {
      this.internalRepeatPending = false;
      this.outputGate.discard();
      this.finishRejectedOutput(failed);
    }
  }

  private finishRejectedOutput(event: { reason: OutputGateRejectionReason; safeText?: string }): void {
    if (this.pendingRepeatTimeout) clearTimeout(this.pendingRepeatTimeout);
    this.pendingRepeatTimeout = undefined;
    this.pendingAutomaticRepeat = undefined;
    this.callbacks.onOutputRejected?.({ ...event, retrying: false });
    if (event.safeText) this.callbacks.onAssistantTranscript?.(event.safeText, this.currentLanguage, true);
    else {
      const fallback = this.currentLanguage === "ar"
        ? "معليش، ما ضبط ردي. ممكن تعيد طلبك؟"
        : "Sorry, I didn't get that right. Could you say it again?";
      this.callbacks.onAssistantTranscript?.(fallback, this.currentLanguage, true);
    }
    if (this.closeAfterPlayback) void this.stop();
    else this.setState("listening");
  }

  private prepareForPatientTurn(): void {
    this.turnStartedAt = performance.now();
    this.audioChunkCount = 0;
    if (this.pendingAutomaticRepeat) this.finishRejectedOutput(this.pendingAutomaticRepeat);
    if (this.pendingRepeatTimeout) clearTimeout(this.pendingRepeatTimeout);
    this.pendingRepeatTimeout = undefined;
    this.pendingAutomaticRepeat = undefined;
    this.internalRepeatPending = false;
    this.automaticRepeatAttempted = false;
    this.modelTurnComplete = false;
  }

  private interruptOutput(): void {
    this.playbackSequence += 1;
    this.diagnostic("output_interrupted", { booking: this.toolHandler.getBookingContext() });
    const playbackWasStarted = this.assistantAudioPlaying;
    this.delivery.currentIdentityReadbackId = undefined;
    this.delivery.currentAvailabilityReadbackPending = false;
    this.delivery.currentGuestConsentPromptSlotId = undefined;
    this.toolHandler.cancelGuestSlotConsentPrompt();
    this.outputGate.interrupt();
    this.assistantAudioPlaying = false;
    this.inputTurnPending = false;
    if (playbackWasStarted) this.callbacks.onStopPlayback?.();
  }

  private fail(message: string, attempt: number): void {
    if (attempt !== this.connectionAttempt || this.stopping) return;
    this.connectionAttempt += 1;
    const session = this.liveSession;
    this.liveSession = undefined;
    this.cleanupDisconnectedState();
    this.setState("error", message);
    this.callbacks.onError?.(message);
    session?.close();
  }

  private handleUnexpectedClose(attempt: number): void {
    if (attempt !== this.connectionAttempt || this.stopping || this.state === "ended" || this.state === "error") return;
    this.connectionAttempt += 1;
    this.liveSession = undefined;
    this.cleanupDisconnectedState();
    this.setState("error", "The voice connection closed. You can restart the session.");
  }

  private cleanupDisconnectedState(): void {
    this.playbackSequence += 1;
    if (this.pendingRepeatTimeout) clearTimeout(this.pendingRepeatTimeout);
    this.pendingRepeatTimeout = undefined;
    this.pendingAutomaticRepeat = undefined;
    this.internalRepeatPending = false;
    this.modelTurnComplete = false;
    this.outputGate.discard();
    this.turns.invalidateCurrentTurn();
    this.assistantAudioPlaying = false;
    this.inputTurnPending = false;
    this.delivery.pendingReadbackId = undefined;
    this.delivery.currentOutputReadbackId = undefined;
    this.delivery.currentIdentityReadbackId = undefined;
    this.delivery.currentAvailabilityReadbackPending = false;
    this.delivery.currentGuestConsentPromptSlotId = undefined;
    this.toolHandler.cancelGuestSlotConsentPrompt();
    this.callbacks.onStopPlayback?.();
    // A transport failure is not a patient cancellation. Retain domain state
    // for the next connection; only an explicit stop abandons a draft.
  }

  private setState(state: AgentSessionState, message?: string): void {
    this.state = state;
    this.diagnostic("session_state", { state, message });
    this.callbacks.onState?.(state, message);
  }

  private diagnostic(event: string, details: Record<string, unknown>, durationMs?: number): void {
    try {
      this.callbacks.onDiagnostic?.({ event, sessionId: this.sessionId, turnId: this.turns.currentTranscript()?.id,
        timestamp: new Date().toISOString(), durationMs, details: diagnosticDetails(details) as Record<string, unknown> });
    } catch { /* Diagnostic collection must never disrupt a patient conversation. */ }
  }

  private async performToolCall(call: NonNullable<NonNullable<LiveServerMessage["toolCall"]>["functionCalls"]>[number]): Promise<AgentFunctionResponse> {
    const started = performance.now();
    const before = this.toolHandler.getBookingContext();
    this.diagnostic("tool_start", { callId: call.id, name: call.name, args: call.args, before });
    try {
      const result = await this.toolHandler(call);
      this.diagnostic("tool_result", { callId: call.id, name: call.name, args: call.args, result: result.response, before, after: this.toolHandler.getBookingContext() }, performance.now() - started);
      return result;
    } catch (error) {
      this.diagnostic("tool_error", { callId: call.id, name: call.name, error: error instanceof Error ? error.message : "Unknown tool error" }, performance.now() - started);
      throw error;
    }
  }
}
