import { useEffect, useRef, useState } from "react";
import { normalizeSimulatedCallingNumber } from "../shared/simulatedCallingNumber";
import type { ApprovedOutput } from "./agent/guardrails";
import type { CaptureOptions, MicrophoneCapture, PcmAudioPlayer } from "./voice/audio";
import { MicrophoneCapture as BrowserMicrophoneCapture, PcmAudioPlayer as BrowserPcmAudioPlayer } from "./voice/audio";
import {
  type AgentSessionState,
  type SessionControllerApi,
  type SessionControllerCallbacks,
} from "./voice/session";
import { ReceptionSessionController, type RecordedOutput } from "./voice/receptionSession";
import { TextComposer } from "./components/TextComposer";
import { PrototypeLogPanel } from "./components/PrototypeLogPanel";
import { Transcript, type ConversationMessage } from "./components/Transcript";
import {
  appendPrototypeLog,
  clearPrototypeLog,
  formatPrototypeLog,
  loadPrototypeLog,
  savePrototypeLog,
  type PrototypeLogEntryType,
} from "./logging/prototypeLog";
import { shouldEnablePrototypeDiagnostics } from "./logging/diagnostics";
import "./styles.css";
import type { SessionDiagnostic } from "./logging/sessionDiagnostic";

type CaptureApi = Pick<MicrophoneCapture, "start" | "stop">;
type AudioPlayerApi = Pick<PcmAudioPlayer, "prepare" | "setMuted" | "play" | "stop" | "close"> & Partial<Pick<PcmAudioPlayer, "beginStream" | "enqueueStream" | "endStream">>;

export type AppProps = {
  showDiagnostics?: boolean;
  createSessionController?: (callbacks: SessionControllerCallbacks) => SessionControllerApi;
  createMicrophoneCapture?: (options: CaptureOptions) => CaptureApi;
  audioPlayer?: AudioPlayerApi;
};

const statusLabels: Record<AgentSessionState, string> = {
  idle: "Not connected",
  connecting: "Connecting",
  connected: "Connected",
  listening: "Listening",
  speaking: "Speaking",
  ended: "Session ended",
  error: "Connection issue",
};

function languageOf(text: string): "en" | "ar" {
  return /[\u0600-\u06ff]/.test(text) ? "ar" : "en";
}

export function App({ showDiagnostics, createSessionController, createMicrophoneCapture, audioPlayer }: AppProps) {
  const diagnosticsEnabled = shouldEnablePrototypeDiagnostics(import.meta.env.MODE, showDiagnostics);
  const [sessionState, setSessionState] = useState<AgentSessionState>("idle");
  const [notice, setNotice] = useState("");
  const [callingNumber, setCallingNumber] = useState("0500000000");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [logEntries, setLogEntries] = useState(() => diagnosticsEnabled ? loadPrototypeLog() : []);
  const [logNotice, setLogNotice] = useState("");
  const [partial, setPartial] = useState<{ text: string; language: "en" | "ar" }>();
  const [text, setText] = useState("");
  const [muted, setMuted] = useState(false);
  const [assistantAudioPlaying, setAssistantAudioPlaying] = useState(false);
  const [microphoneOn, setMicrophoneOn] = useState(false);
  const [player] = useState<AudioPlayerApi>(() => audioPlayer ?? new BrowserPcmAudioPlayer());
  const sessionRef = useRef<SessionControllerApi | undefined>(undefined);
  const captureRef = useRef<CaptureApi | undefined>(undefined);
  const nextMessageId = useRef(0);
  const logEntriesRef = useRef(logEntries);
  const logSequence = useRef(0);
  const pendingAssistantMessageId = useRef<number | undefined>(undefined);
  const outputMessages = useRef(new Map<string, number>());
  const inputMessages = useRef(new Map<string, number>());
  const recordedOutputs = useRef(new Map<string, RecordedOutput>());
  const streamQueues = useRef(new Map<string, Promise<void>>());
  const factories = useRef({ createSessionController, createMicrophoneCapture });

  const appendLog = (type: PrototypeLogEntryType, message: string, diagnostic?: SessionDiagnostic) => {
    if (!diagnosticsEnabled) return;
    const fallbackId = `${Date.now()}-${++logSequence.current}`;
    const entry = {
      ...diagnostic,
      id: globalThis.crypto?.randomUUID?.() ?? fallbackId,
      timestamp: new Date().toISOString(),
      type,
      message,
    };
    const next = appendPrototypeLog(logEntriesRef.current, entry);
    logEntriesRef.current = next;
    setLogEntries(next);
    const saved = savePrototypeLog(next);
    if (!saved) setLogNotice("This browser couldn't save the log; it may be lost when you close the tab.");
    else setLogNotice((current) => current.startsWith("This browser couldn't save") ? "" : current);
  };

  const copyLog = async () => {
    if (!diagnosticsEnabled) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable");
      await navigator.clipboard.writeText(formatPrototypeLog(logEntriesRef.current));
      setLogNotice("Log copied.");
    } catch {
      setLogNotice("Couldn't copy the log. Check clipboard access and try again.");
    }
  };

  const clearLog = () => {
    if (!diagnosticsEnabled) return;
    logEntriesRef.current = [];
    setLogEntries([]);
    setLogNotice(clearPrototypeLog() ? "Log cleared." : "The on-screen log was cleared, but browser storage was unavailable.");
  };

  const appendMessage = (
    role: ConversationMessage["role"],
    content: string,
    fallback = false,
    language?: "en" | "ar",
  ): number | undefined => {
    if (!content.trim()) return undefined;
    const id = ++nextMessageId.current;
    setMessages((previous) => [
      ...previous,
      { id, role, text: content, language: language ?? languageOf(content), fallback },
    ]);
    return id;
  };

  useEffect(() => {
    const stopMicrophone = () => {
      const capture = captureRef.current;
      captureRef.current = undefined;
      if (capture) void capture.stop().catch(() => undefined);
      sessionRef.current?.endMicrophoneStream();
      setMicrophoneOn(false);
      setPartial(undefined);
    };
    const callbacks: SessionControllerCallbacks = {
      onDiagnostic: (event) => appendLog("diagnostic", `${event.event}${event.durationMs !== undefined ? ` · ${Math.round(event.durationMs)} ms` : ""}`, event),
      onState: (state, message) => {
        appendLog("session", `Session: ${state}`);
        if (!(["connected", "listening", "speaking"] as AgentSessionState[]).includes(state)) {
          stopMicrophone();
        }
        setSessionState(state);
        if (message) setNotice(message);
        else if (state !== "error") setNotice("");
      },
      onPatientTranscript: (content, final, source, inputTurnId) => {
        if (inputTurnId && content.trim()) {
          const existingId = inputMessages.current.get(inputTurnId);
          if (existingId !== undefined) setMessages(previous => previous.map(message => message.id === existingId ? {...message,text:content,language:languageOf(content)} : message));
          else {
            const messageId = appendMessage('patient',content);
            if (messageId !== undefined) inputMessages.current.set(inputTurnId,messageId);
          }
          if (final) appendLog('patient',`Patient (${source}): ${content}`);
          return;
        }
        if (final) {
          setPartial(undefined);
          if (content.trim()) appendLog("patient", `Patient (${source}): ${content}`);
          appendMessage("patient", content);
        } else {
          setPartial({ text: content, language: languageOf(content) });
        }
      },
      onAssistantTranscript: (content, language, fallback, outputId) => {
        if (!outputId && content.trim()) appendLog("assistant", `Agent${fallback ? " (fallback)" : ""}: ${content}`);
        if (outputId) {
          const existingId = outputMessages.current.get(outputId);
          if (existingId !== undefined) {
            setMessages((previous) => previous.map((message) => message.id === existingId
              ? { ...message, text: content, language, ...(message.approvedOutput ? { approvedOutput: { ...message.approvedOutput, transcript: content } } : {}) }
              : message));
            return;
          }
          const messageId = appendMessage("assistant", content, false, language);
          if (messageId !== undefined) {
            outputMessages.current.set(outputId, messageId);
            const record = recordedOutputs.current.get(outputId);
            if (record) setMessages((previous) => previous.map((message) => message.id === messageId
              ? { ...message, approvedOutput: { ...record, transcript: content } } : message));
          }
          return;
        }
        pendingAssistantMessageId.current = fallback ? undefined : appendMessage("assistant", content, false, language);
        if (fallback) appendMessage("assistant", content, true, language);
      },
      onRecordedOutput: (outputId, output) => {
        if (output.transcript.trim() && recordedOutputs.current.get(outputId)?.transcript !== output.transcript) appendLog('assistant',`Agent: ${output.transcript}`);
        const record: RecordedOutput = { ...output, audio: output.audio.map((chunk) => ({ ...chunk })) };
        recordedOutputs.current.set(outputId, record);
        let messageId = outputMessages.current.get(outputId);
        if (messageId === undefined && (record.audio.length || record.transcript.trim())) {
          messageId = appendMessage("assistant", record.transcript.trim() || (record.language === "ar" ? "رد صوتي (النص غير متاح)" : "Voice reply (transcript unavailable)"), false, record.language);
          if (messageId !== undefined) outputMessages.current.set(outputId, messageId);
        }
        if (messageId !== undefined) setMessages((previous) => previous.map((message) => message.id === messageId
          ? { ...message, approvedOutput: { ...record, transcript: message.text } } : message));
      },
      onStreamStart: (outputId, started, finished, failed) => {
        setAssistantAudioPlaying(true);
        const failure = (error: unknown) => {
          setAssistantAudioPlaying(false); failed();
          setNotice(error instanceof Error ? error.message : "Audio playback is unavailable.");
        };
        const queue = player.beginStream
          ? player.beginStream(outputId, started, () => { setAssistantAudioPlaying(false); finished(); }, failure).catch(failure)
          : Promise.resolve().then(() => failure(new Error("Streaming audio is unavailable.")));
        streamQueues.current.set(outputId, queue);
      },
      onStreamChunk: (outputId, chunk) => {
        const queued = streamQueues.current.get(outputId);
        if (queued) streamQueues.current.set(outputId, queued.then(() => player.enqueueStream?.(outputId, chunk)));
      },
      onStreamEnd: (outputId) => {
        const queued = streamQueues.current.get(outputId);
        if (queued) void queued.then(() => { player.endStream?.(outputId); streamQueues.current.delete(outputId); });
      },
      onToolResult: ({ toolName, status }) => {
        appendLog("tool", `Tool ${toolName} → ${status}`);
      },
      onApprovedOutput: (output: ApprovedOutput, complete, failed) => {
        appendLog("audio", output.verification === "not_required"
          ? "Audio ready: native Live output; no transcript verifier."
            : output.verification === "local"
              ? "Audio ready: local factual checks passed; no second model."
              : "Audio check passed.");
        setNotice("");
        const messageId = pendingAssistantMessageId.current;
        pendingAssistantMessageId.current = undefined;
        if (messageId !== undefined) {
          setMessages((previous) => previous.map((message) => message.id === messageId
            ? { ...message, approvedOutput: output }
            : message));
        }
        setAssistantAudioPlaying(true);
        const onFailure = (error: Error) => {
          setAssistantAudioPlaying(false);
          appendLog("playback", "Playback failed.");
          failed();
          setNotice(error.message);
        };
        void player.play(output, () => {
          setAssistantAudioPlaying(false);
          complete();
        }, onFailure).catch((error: unknown) => {
          onFailure(error instanceof Error ? error : new Error("Audio playback is unavailable."));
        });
      },
      onOutputRejected: (event) => {
        appendLog("audio", `Audio check withheld: ${event.reason}${event.retrying ? " (retrying)" : ""}`);
        if (diagnosticsEnabled) console.info("Voice reply withheld", { reason: event.reason, retrying: event.retrying === true });
        setNotice(event.retrying
          ? "The voice reply did not come through. Trying once more."
          : event.safeText
            ? "Audio was unavailable. You can ask me to repeat the answer."
            : "The voice reply was unavailable. Please try again.");
      },
      onStopPlayback: () => {
        setAssistantAudioPlaying(false);
        streamQueues.current.clear();
        player.stop();
      },
      onError: (message) => setNotice(message),
    };
    sessionRef.current = factories.current.createSessionController
      ? factories.current.createSessionController(callbacks)
      : new ReceptionSessionController(callbacks);
    return () => {
      void captureRef.current?.stop();
      void sessionRef.current?.stop(false);
      void player.close();
      sessionRef.current = undefined;
    };
  }, [player]);

  const connected = sessionState === "connected" || sessionState === "listening" || sessionState === "speaking";

  const startSession = async () => {
    setNotice("");
    try {
      const simulatedCallingNumber = normalizeSimulatedCallingNumber(callingNumber);
      if (!muted) void player.prepare().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Audio playback is unavailable."));
      await sessionRef.current?.connect({ simulatedCallingNumber });
    } catch (error) {
      if (error instanceof Error) setNotice(error.message);
    }
  };

  const toggleMicrophone = async () => {
    const session = sessionRef.current;
    if (!session) return;
    if (microphoneOn) {
      await captureRef.current?.stop();
      captureRef.current = undefined;
      session.endMicrophoneStream();
      setMicrophoneOn(false);
      return;
    }
    const captureFactory = factories.current.createMicrophoneCapture ?? ((options) => new BrowserMicrophoneCapture(options));
    const capture = captureFactory({
      onAudio: (data) => session.sendMicrophoneAudio(data),
      onVoiceStart: () => session.beginMicrophoneTurn(),
      onVoiceEnd: () => undefined,
      onError: (error) => setNotice(error.message),
    });
    captureRef.current = capture;
    try {
      await capture.start();
      if (captureRef.current !== capture) return;
      setNotice("");
      setMicrophoneOn(true);
    } catch {
      if (captureRef.current === capture) {
        captureRef.current = undefined;
        setMicrophoneOn(false);
      }
    }
  };

  const endSession = async () => {
    await captureRef.current?.stop();
    captureRef.current = undefined;
    sessionRef.current?.endMicrophoneStream();
    await sessionRef.current?.stop();
    setMicrophoneOn(false);
    setPartial(undefined);
  };

  const sendText = () => {
    const sent = sessionRef.current?.sendText(text) ?? false;
    if (sent) setText("");
    else if (!connected) setNotice("Start a session before sending a test message.");
  };

  const replayAudio = (output: ApprovedOutput) => {
    void player.play(output, () => undefined, (error) => setNotice(error.message))
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Audio playback is unavailable."));
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    player.setMuted(next);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">+</div>
        <div>
          <p className="eyebrow">BILINGUAL CLINIC RECEPTION · ARABIC + ENGLISH</p>
          <h1>Rafiq <span lang="ar" dir="rtl">رفيق</span></h1>
        </div>
        <span className={`status-pill status-${sessionState}`} role="status" aria-live="polite">
          <span className="status-dot" />{statusLabels[sessionState]}
        </span>
      </header>

      <section className="demo-notice" aria-label="Prototype safety note">
        <span className="notice-icon" aria-hidden="true">i</span>
        <p><strong>Demo data only.</strong> This prototype uses fictional patients and doctors. Do not enter real medical or personal information.</p>
      </section>

      <section className="control-card" aria-label="Session controls">
        <div className="control-copy">
          <p className="eyebrow">VOICE SESSION</p>
          <h2>Talk naturally, or type a test message</h2>
          <p>English and Arabic are supported. You can mute spoken replies and continue reading the transcript.</p>
          <div className="calling-number-field">
            <label htmlFor="calling-number">Simulated calling number</label>
            <input id="calling-number" type="tel" inputMode="tel" dir="ltr" autoComplete="off"
              value={callingNumber} onChange={(event) => setCallingNumber(event.target.value)}
              disabled={connected || sessionState === "connecting"} aria-describedby="calling-number-help" />
            <small id="calling-number-help">Optional demo number. Leave blank to test spoken number collection. No calls or messages are sent.</small>
          </div>
        </div>
        <div className="control-buttons">
          {!connected ? (
            <button className="button button-primary" onClick={() => void startSession()} disabled={sessionState === "connecting"}>
              {sessionState === "connecting" ? "Connecting…" : "Start session"}
            </button>
          ) : (
            <>
              <button className={`button ${microphoneOn ? "button-listening" : "button-secondary"}`} onClick={() => void toggleMicrophone()}>
                <span aria-hidden="true">{microphoneOn ? "●" : "◉"}</span>
                {microphoneOn ? "Stop microphone" : "Start microphone"}
              </button>
              <button className="button button-secondary" onClick={toggleMute}>
                {muted ? "Unmute audio" : "Mute audio"}
              </button>
              <button className="button button-quiet" onClick={() => void endSession()}>End session</button>
            </>
          )}
        </div>
      </section>

      {notice ? <p className="inline-notice" role="alert">{notice}</p> : null}

      <Transcript
        messages={messages}
        partial={partial}
        replayDisabled={assistantAudioPlaying}
        onReplayAudio={replayAudio}
      />

      <TextComposer disabled={!connected} value={text} onChange={setText} onSend={sendText} />
      {diagnosticsEnabled ? <PrototypeLogPanel entries={logEntries} notice={logNotice} onCopy={() => void copyLog()} onClear={clearLog} /> : null}

      <footer className="app-footer">
        <span>Prototype · fictional records · no real clinic connection</span>
        <span>بيانات تجريبية، بدون اتصال بعيادة حقيقية</span>
      </footer>
    </main>
  );
}
