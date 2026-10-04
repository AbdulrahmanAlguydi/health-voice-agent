import type { LiveCallbacks, LiveServerMessage } from "@google/genai";
import { receptionSnapshotSchema, type ReceptionCommand, type ReceptionMediaEvent, type ReceptionSnapshot, type ReceptionClose } from "../../shared/reception";
import { createReceptionLiveConfig } from "../../shared/receptionPrompt";
import { GEMINI_LIVE_MODEL } from "../../shared/geminiLiveConfig";
import { normalizeSimulatedCallingNumber } from "../../shared/simulatedCallingNumber";
import type { LiveConnectFunction, LiveSessionPort, SessionControllerApi, SessionControllerCallbacks, AgentSessionState } from "./session";
import { diagnosticDetails } from "../logging/sessionDiagnostic";

export type RecordedOutput = { transcript: string; language: "ar" | "en"; audio: Array<{ data: string; mimeType: string }>; verification: "not_required" };
export type ReceptionSessionOptions = SessionControllerCallbacks & { fetch?: typeof globalThis.fetch; connectLive?: LiveConnectFunction };
type Input = { id: string; sequence: number; started: number; source: "text" | "microphone"; attribution: "known" | "uncertain"; transcript: string; finalized: boolean; completed?: boolean };
type Output = { id: string; input: Input; responseActivity: number; text: string; audio: RecordedOutput["audio"]; offers: string[]; exposure: ReceptionMediaEvent["exposure"]; ended: boolean; stream: boolean; audioStarted: boolean; transcriptEmitted: boolean; publishedText?: string };
const reads = new Set(["clinic_information", "get_operation"]);
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const id = () => globalThis.crypto.randomUUID();
function modelResult(result: Record<string, unknown>): Record<string, unknown> {
  if (!result.snapshot) return result;
  const snapshot = receptionSnapshotSchema.parse(result.snapshot);
  const { rawChunks: _raw, ...contact } = snapshot.contact;
  return {...result,snapshot:{sessionId:snapshot.sessionId,version:snapshot.version,status:snapshot.status,clock:snapshot.clock,patientName:snapshot.patientName,contact,draft:snapshot.draft?{...snapshot.draft,contact}:undefined,offers:snapshot.offers}};
}

/** Media and tool transport only: authoritative intake lives in the server snapshot. */
export class ReceptionSessionController implements SessionControllerApi {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly liveConnect: LiveConnectFunction;
  private live?: LiveSessionPort;
  private snapshot?: ReceptionSnapshot;
  private connectionId = id();
  private generation = 0;
  private eventSequence = 0;
  private inputSequence = 0;
  private input: Input = { id: id(), sequence: 0, started: 0, source: "text", attribution: "uncertain", transcript: "", finalized: true };
  private responseInput?: Input;
  private responseActivity = 0;
  private microphoneCaptions: Input[] = [];
  private orphanCaption?: { id: string; text: string };
  private microphoneStreamActive = false;
  private output?: Output;
  private lastOutput?: Output;
  private pendingOffers: string[] = [];
  private media: ReceptionMediaEvent[] = [];
  private toolQueue: Promise<void> = Promise.resolve();
  private unknown?: ReceptionCommand;
  private closing?: { inputId: string; args: Pick<ReceptionClose, "intent" | "outcome">; outputId?: string };
  private reconnectAttempted = false;
  private stopping = false;
  private language: "ar" | "en" = "ar";

  constructor(private readonly callbacks: ReceptionSessionOptions = {}) {
    this.fetcher = callbacks.fetch ?? globalThis.fetch.bind(globalThis);
    this.liveConnect = callbacks.connectLive ?? (async (token, model, config, cb) => {
      const { GoogleGenAI } = await import("@google/genai");
      return new GoogleGenAI({ apiKey: token, apiVersion: "v1beta" }).live.connect({ model, config, callbacks: cb });
    });
  }
  async connect(options?: { simulatedCallingNumber?: string }): Promise<void> {
    if (this.live) return;
    const callingNumber = normalizeSimulatedCallingNumber(options?.simulatedCallingNumber ?? "");
    this.stopping = false; this.reconnectAttempted = false; this.state("connecting");
    try {
      if (this.snapshot && this.snapshot.status !== 'closed') this.snapshot = receptionSnapshotSchema.parse(await this.request(this.path()));
      else {
        this.unknown = undefined; this.media = []; this.pendingOffers = []; this.output = undefined; this.lastOutput = undefined; this.responseInput = undefined; this.microphoneCaptions = []; this.orphanCaption = undefined; this.microphoneStreamActive = false; this.closing = undefined; this.toolQueue = Promise.resolve(); this.inputSequence = 0; this.eventSequence = 0; this.language = 'ar';
        this.input = { id:id(), sequence:0, started:0, source:'text', attribution:'uncertain', transcript:'', finalized:true };
        this.snapshot = receptionSnapshotSchema.parse(await this.request('/api/reception/sessions', { callingNumber }));
      }
      await this.openProvider();
    } catch (error) { this.fail(error); }
  }
  private async openProvider(): Promise<void> {
    const generation = ++this.generation; this.connectionId = id();
    const token = object(await this.request("/api/gemini/live-token", { sessionId: this.snapshot!.sessionId }));
    if (typeof token.token !== "string" || token.model !== GEMINI_LIVE_MODEL || typeof token.voiceName !== "string" || !Number.isFinite(Date.parse(token.expiresAt)) || Date.parse(token.expiresAt) <= Date.now()) throw new Error("The server returned an invalid Live credential.");
    const callbacks: LiveCallbacks = {
      onmessage: (message) => { if (generation === this.generation && !this.stopping) this.onMessage(message); },
      onclose: () => { if (generation === this.generation && !this.stopping) void this.disconnected(); },
      onerror: () => { if (generation === this.generation && !this.stopping) void this.disconnected(); },
    };
    const live = await this.liveConnect(token.token, token.model, createReceptionLiveConfig(token.voiceName, this.snapshot), callbacks);
    if (generation !== this.generation || this.stopping) { live.close(); return; }
    this.live = live; this.state("connected");
    this.diagnostic("reception_connected", { connectionId: this.connectionId, snapshotVersion: this.snapshot!.version });
    live.sendClientContent({ turns: [{ role: "user", parts: [{ text: this.inputSequence ? "Continue this reception conversation from the authoritative server context. Do not replay any write or greet as a new caller." : "ابدئي بتحية استقبال طبيعية ومختصرة، ثم اسألي كيف تساعدين المتصل." }] }], turnComplete: true });
  }
  sendText(text: string): boolean {
    if (!this.live || this.stopping || !text.trim()) return false;
    this.newInput("text", "known"); this.input.transcript = text.trim(); this.input.finalized = true;
    if (/[\u0600-\u06ff]/.test(text)) this.language = "ar"; else if (/[a-z]/i.test(text)) this.language = "en";
    this.callbacks.onPatientTranscript?.(text.trim(), true, "text", this.input.id);
    this.live.sendClientContent({ turns: [{ role: "user", parts: [{ text: text.trim() }] }], turnComplete: true });
    return true;
  }
  beginMicrophoneTurn(): number {
    if (!this.live || this.stopping) return this.inputSequence;
    this.microphoneStreamActive = true;
    this.newInput("microphone", "known"); this.state("listening"); return this.inputSequence;
  }
  sendMicrophoneAudio(data: string): void {
    if (!this.live || this.stopping || !data) return;
    if (!this.microphoneStreamActive) { this.microphoneStreamActive = true; this.newInput("microphone", "uncertain"); }
    this.live.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } });
  }
  endMicrophoneStream(): void { this.microphoneStreamActive = false; this.live?.sendRealtimeInput({ audioStreamEnd: true }); }
  private newInput(source: Input["source"], attribution: Input["attribution"]): void {
    this.finalizePatient(); this.closing = undefined;
    this.finalizeOrphanCaption();
    // Provider captions have no turn IDs. Keep one owner through completion for
    // trailing fragments, but never carry it across a new caller activity.
    this.microphoneCaptions = [];
    const previous = this.responseInput;
    this.input = { id: id(), sequence: ++this.inputSequence, started: ++this.eventSequence, source, attribution, transcript: "", finalized: false };
    if (source === "microphone") this.microphoneCaptions.push(this.input);
    this.diagnostic("reception_input_onset", { inputTurnId: this.input.id, inputSequence: this.input.sequence, eventSequence: this.input.started, source, attribution });
    // An unfinished old response cannot be causally relabelled as a fresh approval.
    if (!previous) this.responseInput = this.input;
    this.interruptOutput();
  }
  private onMessage(message: LiveServerMessage): void {
    const content = message.serverContent;
    const providerEventId = id();
    if (content?.interrupted) {
      this.responseActivity++;
      this.interruptOutput();
      if (this.output) { this.output.ended = true; this.record(this.output); this.lastOutput = this.output; this.output = undefined; }
      this.responseInput = undefined;
    }
    if (content?.inputTranscription?.text) {
      // Captions label existing activity; they never create a consent turn.
      const captionInput = this.microphoneCaptions[0];
      if (!captionInput) this.orphanCaption ??= {id:`caption:${id()}`,text:''};
      this.diagnostic('reception_input_transcription', { providerEventId, text: content.inputTranscription.text, finished: content.inputTranscription.finished === true, turnComplete: content.turnComplete === true, generationComplete: content.generationComplete === true, inputTurnId: captionInput?.id, inputSequence: captionInput?.sequence, captionId:captionInput?.id ?? this.orphanCaption?.id, attribution:'uncertain', activityAttribution:captionInput?.attribution ?? 'uncertain' });
      if (captionInput) {
        captionInput.transcript += content.inputTranscription.text;
        const final = content.inputTranscription.finished === true;
        this.callbacks.onPatientTranscript?.(captionInput.transcript, final || captionInput.finalized, "microphone", captionInput.id);
        if (final) { captionInput.finalized = true; this.microphoneCaptions.shift(); }
      } else {
        const orphan = this.orphanCaption!;
        orphan.text += content.inputTranscription.text;
        this.callbacks.onPatientTranscript?.(orphan.text, content.inputTranscription.finished === true, 'microphone', orphan.id);
        if (content.inputTranscription.finished) this.orphanCaption = undefined;
      }
    }
    if (message.toolCall?.functionCalls?.length) {
      this.responseActivity++;
      const input = { ...this.input };
      if (this.responseInput && this.responseInput.id !== input.id) input.attribution = "uncertain";
      this.responseInput ??= this.input;
      const generation = this.generation, calls = message.toolCall.functionCalls;
      this.toolQueue = this.toolQueue.then(async () => {
        const responses = [];
        for (const call of calls) {
          if (this.stopping || generation !== this.generation) break;
          const result = await this.execute(call.name ?? "", object(call.args), input, call.id);
          responses.push({ id: call.id, name: call.name, response: modelResult(result) });
        }
        if (responses.length && generation === this.generation && !this.stopping) this.live?.sendToolResponse({ functionResponses: responses });
      }).catch((error) => this.fail(error));
    }
    const chunks = content?.modelTurn?.parts?.flatMap((part) => part.inlineData?.data ? [{ data: part.inlineData.data, mimeType: part.inlineData.mimeType ?? "audio/pcm;rate=24000" }] : []) ?? [];
    const text = content?.outputTranscription?.text;
    if (chunks.length || text) {
      const lateCaption = !chunks.length && !this.output && this.lastOutput?.ended && this.lastOutput.input.id === this.input.id && this.lastOutput.responseActivity === this.responseActivity;
      const output = lateCaption ? this.lastOutput! : this.ensureOutput();
      if (text) {
        output.text += text;
        this.diagnostic('reception_output_transcription', { providerEventId, text, finished: content?.outputTranscription?.finished === true, outputId: output.id, inputTurnId: output.input.id, turnComplete: content?.turnComplete === true, generationComplete: content?.generationComplete === true });
        this.publishTranscript(output);
      }
      for (const chunk of chunks) {
        output.audio.push({ ...chunk });
        if (!output.stream) {
          output.stream = true; this.state("speaking");
          this.callbacks.onStreamStart?.(output.id, () => this.expose(output, "audio", "started"), () => this.playbackFinished(output), () => this.playbackFailed(output));
        }
        this.callbacks.onStreamChunk?.(output.id, chunk);
      }
      if (content?.outputTranscription?.finished) this.publishTranscript(output);
      if (lateCaption) this.record(output);
    }
    if (content?.turnComplete || content?.generationComplete) {
      this.diagnostic('reception_turn_boundary', { providerEventId, inputTurnId:this.input.id, outputId:this.output?.id ?? this.lastOutput?.id, turnComplete:content.turnComplete === true, generationComplete:content.generationComplete === true });
      this.finalizePatient();
      if (content.turnComplete) {
        this.input.completed = true;
        this.finalizeOrphanCaption();
      }
      const output = this.output;
      if (output && !output.ended) {
        output.ended = true;
        if (content?.turnComplete) this.publishTranscript(output);
        this.record(output);
        if (output.stream) this.callbacks.onStreamEnd?.(output.id); else if (this.closing) this.playbackFailed(output);
        this.lastOutput = output; this.output = undefined;
      }
      if (content?.turnComplete) {
        this.responseInput = undefined;
        if (this.lastOutput?.input.id === this.input.id) this.publishTranscript(this.lastOutput);
      }
    }
  }
  private ensureOutput(): Output {
    if (this.output) { this.output.responseActivity = this.responseActivity; return this.output; }
    const output: Output = { id: id(), input: this.responseInput ?? this.input, responseActivity: this.responseActivity, text: "", audio: [], offers: this.pendingOffers.splice(0), exposure: "not_started", ended: false, stream: false, audioStarted: false, transcriptEmitted: false };
    this.responseInput ??= this.input; this.output = output; this.lastOutput = output;
    if (this.closing?.inputId === this.input.id) this.closing.outputId = output.id;
    return output;
  }
  private publishTranscript(output: Output): void {
    if (!output.text.trim() || output.publishedText === output.text.trim()) return;
    const first = !output.transcriptEmitted;
    output.transcriptEmitted = true;
    output.publishedText = output.text.trim();
    this.callbacks.onAssistantTranscript?.(output.text.trim(), /[\u0600-\u06ff]/.test(output.text) ? "ar" : this.language, false, output.id);
    if (first) this.expose(output, "text", "started");
  }
  private record(output: Output): void {
    this.callbacks.onRecordedOutput?.(output.id, { transcript: output.text.trim(), language: /[\u0600-\u06ff]/.test(output.text) ? "ar" : this.language, audio: output.audio.map((chunk) => ({ ...chunk })), verification: "not_required" });
  }
  private expose(output: Output, medium: ReceptionMediaEvent["medium"], exposure: ReceptionMediaEvent["exposure"]): void {
    if (medium === "audio" && exposure === "started") output.audioStarted = true;
    this.diagnostic("reception_exposure", { outputId: output.id, offerIds: output.offers, medium, exposure, eventSequence: this.eventSequence + 1 });
    output.exposure = exposure;
    this.media.push({ eventId: id(), connectionId: this.connectionId, outputId: output.id, inputSequence: output.input.sequence, eventSequence: ++this.eventSequence, medium, exposure, offerIds: [...output.offers] });
  }
  private playbackFinished(output: Output): void {
    if (output.audioStarted && output.exposure !== "interrupted") this.expose(output, "audio", "completed");
    if (!this.stopping) this.state("connected");
    if (this.closing?.outputId === output.id && this.closing.inputId === this.input.id) void this.fence(this.closing.args, true);
  }
  private playbackFailed(output: Output): void {
    if (output.audioStarted) this.expose(output, "audio", "interrupted");
    const farewell = Boolean(this.closing);
    this.closing = undefined;
    const message = "Audio was unavailable. You can restart or ask for the answer again.";
    if (farewell) {
      this.live?.close(); this.live = undefined; ++this.generation;
      this.state("error", message);
    } else this.state("connected", message);
    this.callbacks.onError?.(message);
  }
  private interruptOutput(): void {
    const output = this.output ?? this.lastOutput;
    if (output?.audioStarted && output.exposure !== "completed" && output.exposure !== "interrupted") this.expose(output, "audio", "interrupted");
    this.callbacks.onStopPlayback?.();
  }
  private finalizePatient(): void {
    if (this.input.finalized || !this.input.transcript.trim()) return;
    this.input.finalized = true; this.callbacks.onPatientTranscript?.(this.input.transcript.trim(), true, this.input.source, this.input.id);
  }
  private finalizeOrphanCaption(): void {
    if (!this.orphanCaption) return;
    this.callbacks.onPatientTranscript?.(this.orphanCaption.text, true, 'microphone', this.orphanCaption.id);
    this.orphanCaption = undefined;
  }
  private async flushMedia(): Promise<void> {
    while (this.media.length) { await this.request(this.path("/events"), this.media[0], true); this.media.shift(); }
  }
  private async execute(tool: string, args: Record<string, unknown>, input: Input, callId?: string): Promise<Record<string, unknown>> {
    const emergencyFence = tool === "set_emergency" && args.active === true;
    if (this.unknown) {
      const recovered = await this.reconcile(this.unknown);
      const retrySameReady = recovered?.status === 'ready' && tool === 'commit_request' && args.operationId === this.unknown?.args.operationId;
      if ((!recovered || recovered.status === 'ready') && !retrySameReady && !reads.has(tool) && !emergencyFence) return { status: "outcome_unknown", issues: ["Previous action is unresolved; reconcile its result before another mutation."], snapshot: this.snapshot };
    }
    const output = this.lastOutput;
    const command: ReceptionCommand = { eventId: `${this.connectionId}:${callId ?? id()}`, expectedVersion: this.snapshot!.version, tool, args, context: { connectionId: this.connectionId, inputTurnId: input.id, inputSequence: input.sequence, inputStartedEventSequence: input.started, eventSequence: ++this.eventSequence, source: input.source, attribution: input.id === this.input.id ? input.attribution : "uncertain", ...(output ? { outputId: output.id, exposure: output.exposure } : {}) } };
    const started = performance.now();
    this.diagnostic("reception_tool_request", { command });
    try {
      if (!emergencyFence) await this.flushMedia();
      const result = object(await this.request(this.path("/tools"), command, true)); this.applyResult(result);
      this.diagnostic("reception_tool_result", { command, result }, performance.now() - started);
      this.observeToolResult(tool,args,input,result);
      this.callbacks.onToolResult?.({ toolName: tool, status: String(result.status) }); return result;
    } catch {
      if (!emergencyFence || !this.unknown) this.unknown = command;
      const recovered = await this.reconcile(command);
      if (recovered) this.observeToolResult(tool,args,input,recovered);
      this.diagnostic("reception_tool_unknown", { command, recovered }, performance.now() - started);
      return recovered ?? { status: "outcome_unknown", snapshot: this.snapshot, operationId: args.operationId, issues: ["Response lost; outcome remains unresolved."] };
    }
  }
  private observeToolResult(tool: string, args: Record<string, unknown>, input: Input, result: Record<string, any>): void {
    if (tool === 'find_available_slots' && result.status !== 'offers') this.pendingOffers = [];
    if (result.status === 'offers' || Array.isArray(result.facts?.offers)) this.pendingOffers = (result.facts?.offers ?? result.snapshot?.offers ?? []).map((offer: any) => offer.offerId);
    if (tool === 'accept_offer' && result.status === 'needs_clarification' && typeof args.offerId === 'string' && result.snapshot?.offers?.some((offer: any) => offer.offerId === args.offerId) && result.snapshot?.draft?.acceptedOfferId !== args.offerId) this.pendingOffers = [args.offerId];
    if (tool === 'end_session' && result.status === 'ok' && result.facts?.closeRequested === true && input.id === this.input.id) this.closing = { inputId: input.id, args: { outcome: args.outcome as ReceptionClose['outcome'], ...(typeof args.intent === 'string' ? { intent: args.intent } : {}) } };
    if (tool === 'commit_request' && ['committed','rejected'].includes(result.status) && this.unknown?.args.operationId === args.operationId) this.unknown = undefined;
  }
  private applyResult(result: Record<string, any>): void {
    if (!result.snapshot) return;
    const next = receptionSnapshotSchema.parse(result.snapshot);
    if (this.snapshot && (next.sessionId !== this.snapshot.sessionId || next.version < this.snapshot.version)) return;
    this.snapshot = next;
  }
  private async reconcile(command: ReceptionCommand): Promise<Record<string, unknown> | undefined> {
    try {
      const result = object(command.tool === "commit_request"
        ? await this.request(this.path("/tools"), { ...command, eventId: id(), expectedVersion: this.snapshot!.version, tool: "get_operation", args: { operationId: command.args.operationId }, context: { ...command.context, eventSequence: ++this.eventSequence } })
        : await this.request(this.path(`/events/${encodeURIComponent(command.eventId)}`)));
      this.applyResult(result);
      if (command.tool === "commit_request" && result.status === "ready") return result;
      if (result.status === "unresolved" || result.status === "outcome_unknown") return undefined;
      if (this.unknown?.eventId === command.eventId) this.unknown = undefined;
      return result;
    } catch { return undefined; }
  }
  async stop(notify = true): Promise<void> {
    this.stopping = true; this.closing = undefined; this.interruptOutput();
    this.live?.close(); this.live = undefined; ++this.generation;
    if (!notify) return; // Disposal is transport loss, not domain cancellation.
    if (!this.snapshot || this.snapshot.status === "closed") { this.state("ended"); return; }
    await this.fence({ outcome: "unresolved", intent: "explicit_ui_stop" }, false);
  }
  private async fence(args: Pick<ReceptionClose, "intent" | "outcome">, mediaClose: boolean): Promise<void> {
    const inputId = this.input.id;
    try {
      if (mediaClose) await this.flushMedia();
      if (mediaClose && (!this.closing || inputId !== this.closing.inputId)) return;
      let result = object(await this.request(this.path("/close"), { eventId: id(), expectedVersion: this.snapshot!.version, ...args }, true)); this.applyResult(result);
      if (result.status === "conflict") { result = object(await this.request(this.path("/close"), { eventId: id(), expectedVersion: this.snapshot!.version, ...args }, true)); this.applyResult(result); }
      if (result.status !== "closed") throw new Error("Session closing is unresolved. Restart to check its state.");
      this.stopping = true; this.closing = undefined; this.live?.close(); this.live = undefined; ++this.generation; this.state("ended");
    } catch (error) { this.closing = undefined; this.fail(error); }
  }
  private async disconnected(): Promise<void> {
    this.responseActivity++;
    this.live = undefined; ++this.generation; this.interruptOutput(); this.output = undefined; this.responseInput = undefined;
    const farewellFailed = Boolean(this.closing); this.closing = undefined;
    if (farewellFailed || this.reconnectAttempted) { this.state("error", "Voice disconnected. Restart to continue from saved reception state."); return; }
    this.reconnectAttempted = true; this.state("connecting", "Voice disconnected. Reconnecting once.");
    this.diagnostic("reception_reconnect", { connectionId: this.connectionId, inputSequence: this.inputSequence, eventSequence: this.eventSequence });
    try { this.snapshot = receptionSnapshotSchema.parse(await this.request(this.path())); if (this.unknown) await this.reconcile(this.unknown); await this.openProvider(); } catch (error) { this.fail(error); }
  }
  private path(suffix = ""): string { return `/api/reception/sessions/${encodeURIComponent(this.snapshot!.sessionId)}${suffix}`; }
  private state(state: AgentSessionState, message?: string): void { this.callbacks.onState?.(state, message); }
  private diagnostic(event: string, details: Record<string, unknown>, durationMs?: number): void {
    this.callbacks.onDiagnostic?.({ event, sessionId: this.snapshot?.sessionId ?? "not-connected", turnId: this.inputSequence, timestamp: new Date().toISOString(), ...(durationMs !== undefined ? { durationMs } : {}), details: diagnosticDetails({ connectionId: this.connectionId, ...details }) as Record<string, unknown> });
  }
  private fail(error: unknown): void { const message = error instanceof Error ? error.message : "Reception transport is unavailable. Restart to recover saved state."; this.state("error", message); this.callbacks.onError?.(message); }
  private async request(url: string, body?: unknown, retry = false): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 8000);
      try {
        const response = await this.fetcher(url, { ...(body !== undefined ? { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}), signal: abort.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(typeof object(result).error === "string" ? object(result).error : "Reception request failed.");
        return result;
      } catch (error) { if (!retry || attempt >= 1) throw error; } finally { clearTimeout(timeout); }
    }
  }
}
