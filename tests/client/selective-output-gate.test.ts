import { describe, expect, it, vi } from "vitest";
import { AssistantOutputGate } from "../../src/client/agent/guardrails";

function finish(gate: AssistantOutputGate, text: string) {
  gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
  gate.addTranscript(text, true);
  gate.markGenerationComplete();
}

describe("selective output verification", () => {
  it.each([
    ["ar", "حياك الله، خذ راحتك. وش تحب تعرف؟"],
    ["ar", "عندك دكتور معيّن تبغاه، أو نبدأ بالتخصص؟"],
    ["en", "No rush. Would you like to ask about our doctors first?"],
    ["ar", "ما أقدر أساعدك بهالشي. فيه طبيب معين في بالك؟"],
    ["en", "I can't help with that. Which specialty did you have in mind?"],
  ] as const)("plays ordinary %s conversation immediately even when the verifier is offline", (language, text) => {
    const approved = vi.fn();
    const verify = vi.fn(async () => { throw new Error("offline"); });
    const gate = new AssistantOutputGate({ verify, onApproved: approved });
    gate.begin(undefined, language, true, undefined, "conversation");
    finish(gate, text);
    expect(approved).toHaveBeenCalledWith(expect.objectContaining({ transcript: text, conversational: true, verification: "not_required" }));
    expect(verify).not.toHaveBeenCalled();
    gate.discard();
  });

  it("does not make a casual acknowledgement factual just because a directory was previously read", () => {
    const approved = vi.fn();
    const verify = vi.fn();
    const gate = new AssistantOutputGate({ verify, onApproved: approved });
    gate.begin(undefined, "en", true, { sourceText: "Dr Noura, Dermatology", requiredPhrases: [], records: [{ name: "Dr Noura", specialty: "Dermatology" }] }, "conversation");
    finish(gate, "Take your time. Let me know when you're ready.");
    expect(approved).toHaveBeenCalledOnce();
    expect(verify).not.toHaveBeenCalled();
  });

  it.each([
    "Dr Noura specialises in Dermatology.",
    "She speaks English and Arabic.",
    "Your appointment is confirmed.",
    "Give me your patient ID.",
    "The appointment is at 17:00.",
    "الدكتورة نورة تتكلم عربي وإنجليزي.",
    "اعطيني رقم المريض.",
    "أنصحك بالدكتور المناسب لأعراضك.",
    "عندنا دكتور جديد اسمه زيد.",
  ])("still holds a concrete fact/action for verification: %s", async (text) => {
    const approved = vi.fn();
    const rejected = vi.fn();
    const gate = new AssistantOutputGate({ onApproved: approved, onRejected: rejected, verify: async () => ({ approved: false, conversational: false, reason: "unsupported_fact" }) });
    gate.begin(undefined, /[\u0600-\u06ff]/.test(text) ? "ar" : "en", true, undefined, "conversation");
    finish(gate, text);
    await vi.waitFor(() => expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "evidence_mismatch" })));
    expect(approved).not.toHaveBeenCalled();
  });

  it("keeps required readback mode fail-closed instead of treating questions as ordinary conversation", async () => {
    const rejected = vi.fn();
    const gate = new AssistantOutputGate({ onRejected: rejected, verify: async () => { throw new Error("offline"); } });
    gate.begin("Is this your profile?", "en", true, undefined, "required");
    finish(gate, "Is that you?");
    await vi.waitFor(() => expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "verification_unavailable" })));
  });
});
