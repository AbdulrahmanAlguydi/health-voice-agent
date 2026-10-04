import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantOutputGate } from "../../src/client/agent/guardrails";
import { SAFE_REPLY_COPY } from "../../src/shared/safeReplyCopy";

describe("AssistantOutputGate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("holds audio until both generation and the final output transcript are complete", () => {
    const onApproved = vi.fn();
    const gate = new AssistantOutputGate({ onApproved });
    gate.begin("Dr Smith is available on Monday at 10 AM.", "en");
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript("Dr Smith is available on Monday at 10 AM.", true);

    expect(onApproved).not.toHaveBeenCalled();
    gate.markGenerationComplete();

    expect(onApproved).toHaveBeenCalledWith(expect.objectContaining({
      transcript: "Dr Smith is available on Monday at 10 AM.",
      audio: [{ data: "AQID", mimeType: "audio/pcm;rate=24000" }],
    }));
  });

  it("allows one approved warm opener and an equivalent English doctor title without changing facts", () => {
    const onApproved = vi.fn();
    const gate = new AssistantOutputGate({ onApproved });
    gate.begin(
      "We have Dr. Sarah Al-Qahtani in Cardiology at Riyadh Clinic. The directory lists Arabic and English.",
      "en",
    );
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript(
      "Sure, we have Doctor Sarah Al-Qahtani in Cardiology at Riyadh Clinic. The directory lists Arabic and English.",
      true,
    );
    gate.markGenerationComplete();

    expect(onApproved).toHaveBeenCalledWith(expect.objectContaining({
      transcript: "Sure, we have Doctor Sarah Al-Qahtani in Cardiology at Riyadh Clinic. The directory lists Arabic and English.",
    }));
  });

  it("allows a Saudi-friendly opener and equivalent Arabic doctor title/demonstrative forms", () => {
    const onApproved = vi.fn();
    const gate = new AssistantOutputGate({ onApproved });
    gate.begin(
      "هذي أقرب المواعيد المتاحة مع د. سارة القحطاني: الخميس، ٢ أكتوبر، ١٠:٠٠ ص. أي موعد يناسبك؟",
      "ar",
    );
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript(
      "أكيد، هذه أقرب المواعيد المتاحة مع الدكتورة سارة القحطاني: الخميس، ٢ أكتوبر، ١٠:٠٠ ص. أي موعد يناسبك؟",
      true,
    );
    gate.markGenerationComplete();

    expect(onApproved).toHaveBeenCalledOnce();
  });

  it("still rejects a changed doctor name or an added appointment time", () => {
    for (const transcript of [
      "Sure, the available times with Doctor Sara are Monday at 10:00 AM and Tuesday at 2:00 PM. Which works for you?",
      "Sure, the available times with Doctor Sarah are Monday at 10:00 AM, Tuesday at 2:00 PM, and Wednesday at 3:00 PM. Which works for you?",
    ]) {
      const onApproved = vi.fn();
      const onRejected = vi.fn();
      const gate = new AssistantOutputGate({ onApproved, onRejected });
      gate.begin("The available times with Dr. Sarah are Monday at 10:00 AM and Tuesday at 2:00 PM. Which works for you?", "en");
      gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
      gate.addTranscript(transcript, true);
      gate.markGenerationComplete();

      expect(onApproved).not.toHaveBeenCalled();
      expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "evidence_mismatch" }));
    }
  });

  it("allows an approved warm opener on an app-authored context-free reply", () => {
    const onApproved = vi.fn();
    const gate = new AssistantOutputGate({ onApproved });
    gate.begin(undefined, "ar");
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript(`أكيد، ${SAFE_REPLY_COPY.ar.ask_doctor}`, true);
    gate.markGenerationComplete();

    expect(onApproved).toHaveBeenCalledOnce();
  });

  it("does not stack an optional opener onto a response that already starts with one", () => {
    const onApproved = vi.fn();
    const onRejected = vi.fn();
    const gate = new AssistantOutputGate({ onApproved, onRejected });
    gate.begin(SAFE_REPLY_COPY.en.acknowledge, "en");
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript(`Sure, ${SAFE_REPLY_COPY.en.acknowledge}`, true);
    gate.markGenerationComplete();

    expect(onApproved).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "evidence_mismatch" }));
  });

  it("keeps fixed scripts exact when natural variation is disabled", () => {
    const onApproved = vi.fn();
    const onRejected = vi.fn();
    const gate = new AssistantOutputGate({ onApproved, onRejected });
    gate.begin("I can't help with that. What would you like me to check?", "en", false);
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript("Sure, I can't help with that. What would you like me to check?", true);
    gate.markGenerationComplete();

    expect(onApproved).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "evidence_mismatch" }));
  });

  it("accepts reordered output events and does not wait for turnComplete", () => {
    const onApproved = vi.fn();
    const gate = new AssistantOutputGate({ onApproved });
    gate.begin("نعم، الموعد مع الدكتورة ليلى غدًا.", "ar");
    gate.markGenerationComplete();
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript("نعم، الموعد مع الدكتورة ليلى غدًا.", true);

    expect(onApproved).toHaveBeenCalledOnce();
  });

  it("allows an exact app-authored intake question that includes directory terms", () => {
    const onApproved = vi.fn();
    const gate = new AssistantOutputGate({ onApproved });
    const responseText = SAFE_REPLY_COPY.en.ask_doctor;
    gate.begin(responseText, "en");
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript(responseText, true);
    gate.markGenerationComplete();

    expect(onApproved).toHaveBeenCalledWith(expect.objectContaining({ transcript: responseText }));
  });

  it.each([SAFE_REPLY_COPY.en.repeat_request, SAFE_REPLY_COPY.ar.clarify_request, SAFE_REPLY_COPY.en.acknowledge])(
    "allows a context-free application-authored repair or acknowledgement without a tool result: %s",
    (text) => {
      const onApproved = vi.fn();
      const gate = new AssistantOutputGate({ onApproved });
      gate.begin(undefined, /[\u0600-\u06ff]/.test(text) ? "ar" : "en");
      gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
      gate.addTranscript(text, true);
      gate.markGenerationComplete();

      expect(onApproved).toHaveBeenCalledWith(expect.objectContaining({ transcript: text }));
    },
  );

  it("does not allow context-dependent identity or guest-booking scripts without their app state", () => {
    for (const text of [SAFE_REPLY_COPY.en.identity_denied, SAFE_REPLY_COPY.en.ask_book_selected_slot, SAFE_REPLY_COPY.en.request_guest_name]) {
      const onApproved = vi.fn();
      const onRejected = vi.fn();
      const gate = new AssistantOutputGate({ onApproved, onRejected });
      gate.begin(undefined, "en");
      gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
      gate.addTranscript(text, true);
      gate.markGenerationComplete();

      expect(onApproved).not.toHaveBeenCalled();
      expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "evidence_mismatch" }));
    }
  });

  it("rejects fact-bearing output that adds unsupported details", () => {
    const onApproved = vi.fn();
    const onRejected = vi.fn();
    const gate = new AssistantOutputGate({ onApproved, onRejected });
    gate.begin("Dr Smith is available on Monday at 10 AM.", "en");
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript("Dr Smith is available on Monday at 10 AM, and usually works Tuesdays too.", true);
    gate.markGenerationComplete();

    expect(onApproved).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "evidence_mismatch" }));
  });

  it("rejects medical advice even when the response contains the expected data text", () => {
    const onRejected = vi.fn();
    const gate = new AssistantOutputGate({ onRejected });
    gate.begin("Dr Smith is listed as a cardiologist.", "en");
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript("Dr Smith is listed as a cardiologist. You should take medication.", true);
    gate.markGenerationComplete();

    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "disallowed_content" }));
  });

  it("discards queued audio on interruption", () => {
    const onApproved = vi.fn();
    const onRejected = vi.fn();
    const gate = new AssistantOutputGate({ onApproved, onRejected });
    gate.begin("Hello there.", "en");
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript("Hello there.", true);
    gate.interrupt();
    gate.markGenerationComplete();

    expect(onApproved).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "interrupted" }));
  });

  it("fails closed when the final transcript never arrives", async () => {
    const onApproved = vi.fn();
    const onRejected = vi.fn();
    const gate = new AssistantOutputGate({ onApproved, onRejected, timeoutMs: 300 });
    gate.begin("Hello there.", "en");
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.markGenerationComplete();
    await vi.advanceTimersByTimeAsync(301);

    expect(onApproved).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "timeout" }));
  });

  it("fails closed on disallowed medical output in Arabic", () => {
    const onRejected = vi.fn();
    const gate = new AssistantOutputGate({ onRejected });
    gate.begin(undefined, "ar");
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript("أنصحك بأخذ هذا الدواء.", true);
    gate.markGenerationComplete();

    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "disallowed_content" }));
  });

  it("rejects an ungrounded doctor claim that uses an abbreviation", () => {
    const onApproved = vi.fn();
    const onRejected = vi.fn();
    const gate = new AssistantOutputGate({ onApproved, onRejected });
    gate.begin(undefined, "en");
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript("Dr. Nora treats asthma.", true);
    gate.markGenerationComplete();

    expect(onApproved).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "evidence_mismatch" }));
  });

  it("rejects an ungrounded booking-success claim", () => {
    const onApproved = vi.fn();
    const onRejected = vi.fn();
    const gate = new AssistantOutputGate({ onApproved, onRejected });
    gate.begin(undefined, "en");
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript("Your visit is booked for Thursday.", true);
    gate.markGenerationComplete();

    expect(onApproved).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "evidence_mismatch" }));
  });

  it("rejects an ungrounded day and time even when it avoids booking keywords", () => {
    const onApproved = vi.fn();
    const onRejected = vi.fn();
    const gate = new AssistantOutputGate({ onApproved, onRejected });
    gate.begin(undefined, "en");
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript("Tomorrow at 4 should work.", true);
    gate.markGenerationComplete();

    expect(onApproved).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "evidence_mismatch" }));
  });

  it("rejects ungrounded plural doctor claims in English and Arabic", () => {
    for (const [text, language] of [
      ["These doctors work here.", "en"],
      ["الأطباء موجودون هنا.", "ar"],
    ] as const) {
      const onApproved = vi.fn();
      const onRejected = vi.fn();
      const gate = new AssistantOutputGate({ onApproved, onRejected });
      gate.begin(undefined, language);
      gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
      gate.addTranscript(text, true);
      gate.markGenerationComplete();

      expect(onApproved).not.toHaveBeenCalled();
      expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "evidence_mismatch" }));
    }
  });

  it("rejects common plural and definite-article forms of medical claims", () => {
    for (const [text, language] of [
      ["The medications are safe.", "en"],
      ["خذ الدواء.", "ar"],
      ["هذا هو التشخيص والعلاج.", "ar"],
    ] as const) {
      const onApproved = vi.fn();
      const onRejected = vi.fn();
      const gate = new AssistantOutputGate({ onApproved, onRejected });
      gate.begin(undefined, language);
      gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
      gate.addTranscript(text, true);
      gate.markGenerationComplete();

      expect(onApproved).not.toHaveBeenCalled();
      expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "disallowed_content" }));
    }
  });
});
