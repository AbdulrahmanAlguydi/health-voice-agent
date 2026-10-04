import type { PrototypeLogEntry } from "../logging/prototypeLog";
import { useLayoutEffect, useRef } from 'react';

export type PrototypeLogPanelProps = {
  entries: PrototypeLogEntry[];
  notice?: string;
  onCopy: () => void;
  onClear: () => void;
};

function displayTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function PrototypeLogPanel({ entries, notice, onCopy, onClear }: PrototypeLogPanelProps) {
  const panelRef = useRef<HTMLDetailsElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const scrollLatest = () => { if (panelRef.current?.open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; };
  useLayoutEffect(scrollLatest, [entries]);
  return (
    <details ref={panelRef} onToggle={scrollLatest} className="prototype-log-panel">
      <summary className="prototype-log-summary">
        <span className="prototype-log-summary-title">Test log · {entries.length} events</span>
        <span className="prototype-log-summary-note">Local only</span>
      </summary>
      <section className="prototype-log-content" aria-label="Prototype test log">
        <div className="prototype-log-heading">
          <div>
            <p className="eyebrow">LOCAL TEST LOG</p>
            <h2>Conversation diagnostics</h2>
          </div>
          <div className="prototype-log-actions">
            <button className="button button-secondary" type="button" onClick={onCopy} disabled={!entries.length}>
              Copy log
            </button>
            <button className="button button-quiet" type="button" onClick={onClear} disabled={!entries.length}>
              Clear log
            </button>
          </div>
        </div>
        {notice ? <p className="prototype-log-notice" role="status" aria-live="polite">{notice}</p> : null}
        {entries.length ? (
          <ol ref={listRef} className="prototype-log-list" aria-label="Test log events">
            {entries.map((entry) => (
              <li className={`prototype-log-entry log-${entry.type}`} key={entry.id}>
                <time dateTime={entry.timestamp}>{displayTime(entry.timestamp)}</time>
                <span className="prototype-log-event-type">{entry.type}</span>
                <p dir="auto">{entry.message}</p>
                {entry.event ? <details><summary>Event details</summary><pre dir="auto">{JSON.stringify({ sessionId: entry.sessionId, turnId: entry.turnId, durationMs: entry.durationMs, details: entry.details }, null, 2)}</pre></details> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="prototype-log-empty">No events logged yet.</p>
        )}
        <p className="prototype-log-footnote">Stored on this device only. Audio and API credentials are never recorded.</p>
      </section>
    </details>
  );
}
