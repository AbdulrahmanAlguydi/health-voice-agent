import { describe, it, expect, vi } from "vitest";
import { AssistantOutputGate } from "../../src/client/agent/guardrails";

function finish(gate: AssistantOutputGate, text: string) {
  gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
  gate.addTranscript(text, true);
  gate.markGenerationComplete();
}

describe("meaning-based audio gate", () => {
  it.each([
    ["ar", "هل عندك طبيب معين أو تخصص محدد في بالك؟"],
    ["en", "Have you got a specific physician or department in mind?"],
  ] as const)("uses the semantic verdict for natural %s questions rather than a word list", async (language, text) => {
    const approved = vi.fn();
    const gate = new AssistantOutputGate({ onApproved: approved, verify: async () => ({ approved: true, conversational: true, reason: "supported" }) });
    gate.begin(undefined, language);
    finish(gate, text);
    await vi.waitFor(() => expect(approved).toHaveBeenCalledOnce());
    expect(approved.mock.calls[0][0].transcript).toBe(text);
  });

  it("does not bypass a denied verdict even when the old vocabulary matcher would approve", async () => {
    const rejected = vi.fn();
    const approved = vi.fn();
    const gate = new AssistantOutputGate({ onApproved: approved, onRejected: rejected, verify: async () => ({ approved: false, conversational: false, reason: "unsupported_fact" }) });
    gate.begin(undefined, "en");
    finish(gate, "I can help you book an appointment.");
    await vi.waitFor(() => expect(rejected).toHaveBeenCalledOnce());
    expect(approved).not.toHaveBeenCalled();
  });

  it("fails closed on verifier failure", async () => {
    const rejected = vi.fn();
    const gate = new AssistantOutputGate({ onRejected: rejected, verify: async () => { throw new Error("offline"); } });
    gate.begin(undefined, "en");
    finish(gate, "I can help you.");
    await vi.waitFor(() => expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "verification_unavailable" })));
  });

  it("ignores a stale acceptance after an interruption and new generation", async () => {
    let resolve: (verdict: { approved: boolean; conversational: boolean; reason: "supported" }) => void = () => {};
    let signal: AbortSignal | undefined;
    const approved = vi.fn();
    const gate = new AssistantOutputGate({ onApproved: approved, verify: (_request, abort) => { signal = abort; return new Promise((done) => { resolve = done; }); } });
    gate.begin(undefined, "ar");
    finish(gate, "هل عندك طبيب معين أو تخصص محدد في بالك؟");
    gate.interrupt();
    gate.begin("New expected reply", "en", false);
    resolve({ approved: true, conversational: true, reason: "supported" });
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
    expect(approved).not.toHaveBeenCalled();
    gate.discard();
  });

  it("verifies a generation only once when completion is repeated", async () => {
    const verify = vi.fn(async () => ({ approved: true, conversational: true, reason: "supported" as const }));
    const gate = new AssistantOutputGate({ verify });
    gate.begin(undefined, "en");
    finish(gate, "Have you got a physician in mind?");
    gate.markGenerationComplete();
    await Promise.resolve();
    expect(verify).toHaveBeenCalledOnce();
    gate.discard();
  });

  it("retains exact opening/scope checks even if a verifier would approve", () => {
    const verify = vi.fn();
    const rejected = vi.fn();
    const gate = new AssistantOutputGate({ verify, onRejected: rejected });
    gate.begin("I can't help with that. Which doctor?", "en", false);
    finish(gate, "I can help with anything.");
    expect(rejected).toHaveBeenCalledOnce();
    expect(verify).not.toHaveBeenCalled();
  });

  it("times out a hung verifier without approving audio", async () => {
    vi.useFakeTimers();
    try {
      const approved = vi.fn();
      const rejected = vi.fn();
      let signal: AbortSignal | undefined;
      const gate = new AssistantOutputGate({ onApproved: approved, onRejected: rejected,
        verify: (_input, abort) => { signal = abort; return new Promise(() => {}); } });
      gate.begin(undefined, "en");
      finish(gate, "Which physician did you have in mind?");
      await vi.advanceTimersByTimeAsync(12000);
      expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "timeout" }));
      expect(signal?.aborted).toBe(true);
      expect(approved).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("rejects a malformed approval instead of trusting a truthy value", async () => {
    const rejected = vi.fn();
    const gate = new AssistantOutputGate({ onRejected: rejected,
      verify: async () => ({ approved: "yes", conversational: true, reason: "supported" }) as never });
    gate.begin(undefined, "en");
    finish(gate, "Which physician did you have in mind?");
    await vi.waitFor(() => expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "verification_unavailable" })));
  });
});
