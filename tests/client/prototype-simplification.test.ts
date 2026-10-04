import { describe, expect, it, vi } from "vitest";
import type { LiveCallbacks, LiveServerMessage } from "@google/genai";
import { GeminiLiveSessionController } from "../../src/client/voice/session";
import { GEMINI_OPENING_TEXT } from "../../src/shared/geminiLiveConfig";

const json = (body: unknown) => new Response(JSON.stringify(body));
async function setup(withDisplayedTranscript = false) {
  let callbacks: LiveCallbacks | undefined;
  const live = { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn() };
  const outputs = vi.fn();
  const diagnostics = vi.fn();
  const fetch = vi.fn().mockResolvedValueOnce(json({ token: "secret-token", model: "gemini-3.8-live", voiceName: "Kore", expiresAt: new Date(Date.now() + 600000).toISOString() }));
  const controller = new GeminiLiveSessionController({ fetch, onApprovedOutput: outputs,
    onAssistantTranscript: withDisplayedTranscript ? vi.fn() : undefined,
    connectLive: async (_token, _model, _config, cb) => { callbacks = cb; return live; },
    // New diagnostic callback; runtime must tolerate collectors failing.
    onDiagnostic: diagnostics,
  });
  const emit = (text: string, audio = true) => callbacks?.onmessage({ serverContent: {
    modelTurn: { parts: audio ? [{ inlineData: { data: "AQIDBA==", mimeType: "audio/pcm;rate=24000" } }] : [] },
    outputTranscription: { text, finished: true }, generationComplete: true, turnComplete: true,
  } } as unknown as LiveServerMessage);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const count = live.sendToolResponse.mock.calls.length + 1;
    callbacks?.onmessage({ toolCall: { functionCalls: [{ id: `call-${count}`, name, args }] } } as unknown as LiveServerMessage);
    await vi.waitFor(() => expect(live.sendToolResponse).toHaveBeenCalledTimes(count));
    return live.sendToolResponse.mock.calls.at(-1)![0].functionResponses[0].response;
  };
  const finish = () => outputs.mock.calls.at(-1)?.[1]();
  await controller.connect(); emit(GEMINI_OPENING_TEXT); finish();
  return { controller, live, outputs, diagnostics, fetch, emit, call, finish,
    input: (text: string) => callbacks?.onmessage({ serverContent: { inputTranscription: { text, finished: true } } } as unknown as LiveServerMessage),
    disconnect: () => callbacks?.onclose?.({} as CloseEvent),
    batch: (calls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => callbacks?.onmessage({ toolCall: { functionCalls: calls } } as unknown as LiveServerMessage),
    interrupt: () => callbacks?.onmessage({ serverContent: { interrupted: true } } as unknown as LiveServerMessage) };
}

it("keeps microphone identity clarification attached to the found profile through repeated unclear captions", async () => {
  const s = await setup();
  s.fetch.mockResolvedValueOnce(json({ status: "found", patient: { patientId: "123", fullName: "مريض تجريبي" }, responseText: "لقيت ملف باسم مريض تجريبي. هذا ملفك؟" }))
    .mockResolvedValueOnce(json({ status: "pending", pendingId: "pending-draft-12345678901234567890", responseText: "موعد مع ندى، تأكد الحجز؟" }));
  s.controller.sendText("أبي أحجز مع ندى ورقم المريض 123");
  await s.call("begin_booking", { patientId: "123", language: "ar" });
  s.emit("لقيت ملف باسم مريض تجريبي. هذا ملفك؟"); s.finish();
  for (const caption of ["اي هذا ما في.", "ما سمعتك"]) {
    s.controller.beginMicrophoneTurn(); s.input(caption);
    expect((await s.call("prepare_booking", { doctorIdentifier: "ندى", slotId: "slot-1", language: "ar" })).status).toBe("needs_identity_confirmation");
    s.emit("الملف باسم مريض تجريبي، هذا ملفك؟"); s.finish();
  }
  s.controller.beginMicrophoneTurn(); s.input("اي هذا");
  await s.call("confirm_patient_identity", { decision: "own_record", language: "ar" });
  expect((await s.call("prepare_booking", { doctorIdentifier: "ندى", slotId: "slot-1", language: "ar" })).status).toBe("pending");
  expect(s.fetch.mock.calls.filter(([url]) => url === "/api/patients/lookup")).toHaveLength(1);
  await s.controller.stop(false);
});

describe("focused prototype simplification", () => {
  it("accepts a fresh microphone confirmation during audio after the complete summary is displayed", async () => {
    const s = await setup(true);
    const pendingId = "pending-draft-12345678901234567890";
    s.fetch.mockResolvedValueOnce(json({ status: "found", patient: { patientId: "123", fullName: "Test Patient" }, responseText: "Is this Test Patient?" }))
      .mockResolvedValueOnce(json({ status: "pending", pendingId, responseText: "Saud, Saturday 3 October at noon. Shall I confirm?" }))
      .mockResolvedValueOnce(json({ status: "confirmed", responseText: "Booked." }));
    s.controller.sendText("Book with Saud. My ID is 123.");
    await s.call("begin_booking", { patientId: "123", language: "en" });
    s.emit("Your profile is Test Patient, is that you?"); s.finish();
    s.controller.sendText("Yes, that's me.");
    await s.call("confirm_patient_identity", { decision: "own_record", language: "en" });
    await s.call("prepare_booking", { doctorIdentifier: "Saud", slotId: "slot-1", language: "en" });
    s.emit("Saud, Saturday October third at noon. Shall I confirm?");
    // Do not finish playback; the full summary is already displayed in the web chat.
    s.interrupt();
    s.controller.beginMicrophoneTurn();
    s.input("Yes, confirm the booking.");
    expect((await s.call("confirm_booking", { decision: "approve", language: "en" })).status).toBe("confirmed");
    expect(s.fetch.mock.calls.filter(([url]) => url === "/api/bookings/confirm")).toHaveLength(1);
    await s.controller.stop(false);
  });
  it.each([
    ["ar", "خلينا نشوف مواعيد الدكتور سعود", "هذي أقرب المواعيد: بكرة الساعة اثنا عشر الظهر، أو بعد يومين الساعة خمسة مساءً. أي موعد يناسبك؟"],
    ["en", "What times does Saud have?", "There's a noon appointment tomorrow, or five in the evening the day after. Which suits you?"],
  ])("plays natural %s availability without sentence matching", async (language, input, reply) => {
    const s = await setup();
    s.fetch.mockResolvedValueOnce(json({ status: "ok", doctor: { doctorId: "doc-029", name: language === "ar" ? "د. سعود الأسمري" : "Dr Saud" },
      slots: [{ slotId: "slot-1", relativeDateTime: language === "ar" ? "بكرة الساعة ١٢:٠٠ الظهر" : "tomorrow at 12:00" }, { slotId: "slot-2", relativeDateTime: language === "ar" ? "بعد يومين الساعة ٥:٠٠ مساءً" : "in 2 days at 17:00" }], responseText: "Stored availability labels." }));
    s.controller.sendText(input);
    await s.call("get_available_slots", { doctorIdentifier: "Saud", language });
    s.emit(reply);
    expect(s.outputs.mock.calls.at(-1)?.[0]).toMatchObject({ transcript: reply, verification: "not_required" });
    s.finish();
    expect(s.fetch.mock.calls.map(([url]) => url)).toEqual(["/api/gemini/live-token", "/api/slots/search"]);
    await s.controller.stop(false);
  });

  it.each(["interruption", "playback_failure"])("preserves a draft after %s and requires replay plus fresh final consent", async (failure) => {
    const s = await setup();
    const pendingId = "pending-draft-12345678901234567890";
    s.fetch.mockResolvedValueOnce(json({ status: "found", patient: { patientId: "123", fullName: "Test Patient" }, responseText: "Is this Test Patient?" }))
      .mockResolvedValueOnce(json({ status: "pending", pendingId, responseText: "Test Patient, Dr Saud, Saturday 3 October at noon. Shall I confirm?" }))
      .mockResolvedValueOnce(json({ status: "confirmed", responseText: "Booked." }));
    s.controller.sendText("Book with Saud. My ID is 123.");
    await s.call("begin_booking", { patientId: "123", language: "en" });
    s.emit("Your profile is Test Patient, is that you?"); s.finish();
    s.controller.sendText("Yes, that's me.");
    await s.call("confirm_patient_identity", { decision: "own_record", language: "en" });
    await s.call("prepare_booking", { doctorIdentifier: "Saud", slotId: "slot-1", language: "en" });
    s.emit("Test Patient, your appointment would be with Saud on Saturday, October third at noon. Shall I book it?");
    const staleCompletion = s.outputs.mock.calls.at(-1)![1];
    if (failure === "interruption") s.interrupt();
    else s.outputs.mock.calls.at(-1)![2]();
    staleCompletion();
    s.controller.sendText("Yes");
    const premature = await s.call("confirm_booking", { decision: "approve", language: "en" });
    expect(premature.status).toBe("pending");
    expect(s.fetch.mock.calls.map(([url]) => url)).not.toContain("/api/bookings/cancel");
    expect(s.fetch.mock.calls.map(([url]) => url)).not.toContain("/api/bookings/confirm");
    s.emit("Test Patient, Saud, Saturday October third at noon. Shall I confirm?"); s.finish();
    // Explicit replay is also read-only: it must not re-prepare or commit.
    s.controller.sendText("Say that again please.");
    expect((await s.call("repeat_last_response", { language: "en" })).status).toBe("pending");
    s.emit("Test Patient, Saud, Saturday October third at noon. Shall I confirm?"); s.finish();
    s.controller.sendText("Yes, please.");
    expect((await s.call("confirm_booking", { decision: "approve", language: "en" })).status).toBe("confirmed");
    expect(s.fetch.mock.calls.filter(([url]) => url === "/api/bookings/confirm")).toHaveLength(1);
    await s.controller.stop(false);
  });

  it("allows cancelling then ending in one ordered batch", async () => {
    const s = await setup();
    s.controller.sendText("Never mind, cancel and goodbye.");
    s.batch([{ id: "cancel", name: "cancel_pending_booking", args: { language: "en" } }, { id: "end", name: "end_session", args: {} }]);
    await vi.waitFor(() => expect(s.live.sendToolResponse).toHaveBeenCalledOnce());
    expect(s.live.sendToolResponse.mock.calls[0][0].functionResponses[1].response.status).toBe("ending");
    s.emit("All right, goodbye."); s.finish();
    await vi.waitFor(() => expect(s.live.close).toHaveBeenCalledOnce());
  });

  it("logs tool inputs/results, HTTP latency and unplayed transcript without credentials or raw audio", async () => {
    const s = await setup();
    s.fetch.mockResolvedValueOnce(json({ status: "found", doctor: { name: "د. سعود", specialty: "طب الأسنان" }, responseText: "د. سعود، طب الأسنان" }));
    s.controller.sendText("وش تخصص سعود؟");
    await s.call("get_doctor_details", { doctorIdentifier: "سعود", language: "ar" });
    s.emit("سعود تخصصه طب الأسنان.", false);
    const events = s.diagnostics.mock.calls.map(([event]) => event);
    expect(events).toContainEqual(expect.objectContaining({ event: "tool_result", details: expect.objectContaining({ args: { doctorIdentifier: "سعود", language: "ar" }, result: expect.objectContaining({ status: "found" }) }), durationMs: expect.any(Number) }));
    expect(events).toContainEqual(expect.objectContaining({ event: "http_result", details: expect.objectContaining({ path: "/api/doctors/details", status: 200 }), durationMs: expect.any(Number) }));
    expect(events).toContainEqual(expect.objectContaining({ event: "output_unplayed", details: expect.objectContaining({ transcript: "سعود تخصصه طب الأسنان.", reason: "missing_audio" }) }));
    expect(JSON.stringify(events)).not.toContain("secret-token");
    expect(JSON.stringify(events)).not.toContain("AQIDBA==");
    await s.controller.stop(false);
  });

  it("ignores a late playback callback after the provider disconnects", async () => {
    const s = await setup();
    s.controller.sendText("Hi"); s.emit("How can I help?");
    const stale = s.outputs.mock.calls.at(-1)![1];
    s.disconnect(); stale();
    const states = s.diagnostics.mock.calls.map(([event]) => event).filter((event) => event.event === "session_state");
    expect(states.at(-1).details.state).toBe("error");
    expect(s.controller.sendText("Are you there?")).toBe(false);
    await s.controller.stop(false);
  });

  it("continues a lookup even if the diagnostic collector throws", async () => {
    const s = await setup();
    s.diagnostics.mockImplementation(() => { throw new Error("collector unavailable"); });
    s.fetch.mockResolvedValueOnce(json({ status: "not_found", responseText: "No matching doctor." }));
    s.controller.sendText("Do you have Dr Zaid?");
    expect((await s.call("search_doctors", { query: "Zaid", language: "en" })).status).toBe("not_found");
    s.emit("I couldn't find that doctor. Do you have another name?");
    expect(s.outputs.mock.calls.at(-1)?.[0].transcript).toContain("another name");
    await s.controller.stop(false);
  });
});
