import { useLayoutEffect, useRef } from "react";
import type { Language } from "../../shared/contracts";
import type { ApprovedOutput } from "../agent/guardrails";

export type ConversationMessage = {
  id: number;
  role: "patient" | "assistant";
  text: string;
  language: Language;
  fallback?: boolean;
  approvedOutput?: ApprovedOutput;
};

type TranscriptProps = {
  messages: ConversationMessage[];
  partial?: { text: string; language: Language };
  replayDisabled: boolean;
  onReplayAudio: (output: ApprovedOutput) => void;
};

export function Transcript({ messages, partial, replayDisabled, onReplayAudio }: TranscriptProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, partial?.text]);

  return (
    <section className="transcript-panel" aria-label="Conversation transcript">
      <div className="transcript-heading">
        <div>
          <p className="eyebrow">LIVE TRANSCRIPT</p>
          <h2>Conversation</h2>
        </div>
        <span className="transcript-count">{messages.length} messages</span>
      </div>
      <div ref={listRef} className="transcript-list" role="log" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 && !partial ? (
          <p className="transcript-empty">Start a session, then speak or send a test message.</p>
        ) : null}
        {messages.map((message) => (
          <article className={`transcript-message ${message.role}`} key={message.id}>
            <span className="message-speaker">{message.role === "patient" ? "You" : "Appointments assistant"}</span>
            <p lang={message.language} dir={message.language === "ar" ? "rtl" : "ltr"}>
              {message.text}
            </p>
            {message.fallback ? <span className="message-note">Audio unavailable; text shown for recovery.</span> : null}
            {message.approvedOutput ? (
              <button
                className="message-play"
                type="button"
                lang={message.language}
                dir={message.language === "ar" ? "rtl" : "ltr"}
                aria-label={message.language === "ar" ? "إعادة تشغيل الرد الصوتي" : "Replay audio"}
                disabled={replayDisabled}
                onClick={() => onReplayAudio(message.approvedOutput!)}
              >
                <span aria-hidden="true">▶</span>
                <span>{message.language === "ar" ? "إعادة التشغيل" : "Replay audio"}</span>
              </button>
            ) : null}
          </article>
        ))}
        {partial ? (
          <article className="transcript-message patient partial" aria-label="Live, unfinished transcript">
            <span className="message-speaker">You · listening</span>
            <p lang={partial.language} dir={partial.language === "ar" ? "rtl" : "ltr"}>{partial.text}</p>
          </article>
        ) : null}
      </div>
    </section>
  );
}
