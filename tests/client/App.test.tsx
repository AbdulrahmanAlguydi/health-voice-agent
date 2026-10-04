// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/client/App";
import type { ApprovedOutput } from "../../src/client/agent/guardrails";
import type { SessionControllerApi, SessionControllerCallbacks } from "../../src/client/voice/session";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("web voice-agent interface", () => {
  it("validates the optional calling number and locks it only while a session is active", async () => {
    let callbacks: SessionControllerCallbacks | undefined;
    const session: SessionControllerApi = {
      connect: vi.fn(async () => callbacks?.onState?.("connected")),
      beginMicrophoneTurn: vi.fn(() => 1), sendMicrophoneAudio: vi.fn(), endMicrophoneStream: vi.fn(),
      sendText: vi.fn(() => true), stop: vi.fn(async () => callbacks?.onState?.("ended")),
    };
    render(<App createSessionController={(next) => { callbacks = next; return session; }}
      audioPlayer={{ prepare: vi.fn(async () => undefined), setMuted: vi.fn(), play: vi.fn(), stop: vi.fn(), close: vi.fn(async () => undefined) }} />);
    const number = screen.getByRole("textbox", { name: "Simulated calling number" });
    expect(number).toHaveValue("0500000000");
    fireEvent.change(number, { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    expect(session.connect).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter a Saudi mobile/)).toBeInTheDocument();
    fireEvent.change(number, { target: { value: "+966 50 000 0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await waitFor(() => expect(number).toBeDisabled());
    expect(session.connect).toHaveBeenCalledWith({ simulatedCallingNumber: "0500000000" });
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await waitFor(() => expect(number).toBeEnabled());
    fireEvent.change(number, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await waitFor(() => expect(session.connect).toHaveBeenLastCalledWith({ simulatedCallingNumber: undefined }));
  });
  it("supports a readable typed conversation, Arabic right-to-left output, mute, and restart/end controls", async () => {
    const user = userEvent.setup();
    let callbacks: SessionControllerCallbacks | undefined;
    const session: SessionControllerApi = {
      connect: vi.fn(async () => callbacks?.onState?.("connected")),
      beginMicrophoneTurn: vi.fn(() => 1),
      sendMicrophoneAudio: vi.fn(),
      endMicrophoneStream: vi.fn(),
      sendText: vi.fn((text) => {
        callbacks?.onPatientTranscript?.(text, true, "text");
        return true;
      }),
      stop: vi.fn(async () => callbacks?.onState?.("ended")),
    };
    const audioPlayer = {
      prepare: vi.fn(async () => undefined),
      setMuted: vi.fn(),
      play: vi.fn(async (_output, complete) => complete()),
      stop: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    const app = render(
      <App
        createSessionController={(nextCallbacks) => {
          callbacks = nextCallbacks;
          return session;
        }}
        audioPlayer={audioPlayer}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start session" }));
    expect(screen.getByText("Connected")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Type a message in Arabic or English" });
    await user.type(input, "Which doctors speak Arabic?");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(session.sendText).toHaveBeenCalledWith("Which doctors speak Arabic?");
    expect(screen.getByText("Which doctors speak Arabic?")).toBeInTheDocument();

    act(() => callbacks?.onAssistantTranscript?.("السلام عليكم، أهلًا بك في مجمع عافية الطبي. كيف أقدر أساعدك؟", "ar"));
    expect(screen.getByText("السلام عليكم، أهلًا بك في مجمع عافية الطبي. كيف أقدر أساعدك؟").closest("p")).toHaveAttribute("dir", "rtl");

    await user.click(screen.getByRole("button", { name: "Mute audio" }));
    expect(audioPlayer.setMuted).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole("button", { name: "End session" }));
    expect(session.stop).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Start session" })).toBeEnabled();
    app.unmount();
  });

  it("keeps earlier patient bubbles in the conversation after more than 100 messages", () => {
    let callbacks: SessionControllerCallbacks | undefined;
    const session: SessionControllerApi = {
      connect: vi.fn(async () => undefined),
      beginMicrophoneTurn: vi.fn(() => 1),
      sendMicrophoneAudio: vi.fn(),
      endMicrophoneStream: vi.fn(),
      sendText: vi.fn(() => true),
      stop: vi.fn(async () => undefined),
    };
    render(
      <App createSessionController={(nextCallbacks) => {
        callbacks = nextCallbacks;
        return session;
      }} />,
    );

    act(() => {
      for (let index = 0; index < 55; index += 1) {
        callbacks?.onPatientTranscript?.(`Patient turn ${index}`, true, "text");
        callbacks?.onAssistantTranscript?.(`Assistant turn ${index}`, "en");
      }
    });

    expect(screen.getByText("Patient turn 0")).toBeInTheDocument();
    expect(screen.getByText("110 messages")).toBeInTheDocument();
  });

  it("does not allow microphone use before session connection", () => {
    const session: SessionControllerApi = {
      connect: vi.fn(async () => undefined),
      beginMicrophoneTurn: vi.fn(() => 1),
      sendMicrophoneAudio: vi.fn(),
      endMicrophoneStream: vi.fn(),
      sendText: vi.fn(() => false),
      stop: vi.fn(async () => undefined),
    };
    render(<App createSessionController={() => session} />);

    expect(screen.queryByRole("button", { name: "Start microphone" })).not.toBeInTheDocument();
  });

  it("replays the exact approved assistant audio without replaying patient or fallback messages", async () => {
    const user = userEvent.setup();
    let callbacks: SessionControllerCallbacks | undefined;
    const session: SessionControllerApi = {
      connect: vi.fn(async () => undefined),
      beginMicrophoneTurn: vi.fn(() => 1),
      sendMicrophoneAudio: vi.fn(),
      endMicrophoneStream: vi.fn(),
      sendText: vi.fn(() => true),
      stop: vi.fn(async () => undefined),
    };
    const audioPlayer = {
      prepare: vi.fn(async () => undefined),
      setMuted: vi.fn(),
      play: vi.fn(async (_output: ApprovedOutput, complete: () => void) => complete()),
      stop: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    render(
      <App
        createSessionController={(nextCallbacks) => {
          callbacks = nextCallbacks;
          return session;
        }}
        audioPlayer={audioPlayer}
      />,
    );

    const approvedOutput: ApprovedOutput = {
      transcript: "Your appointment is booked for Tuesday at 10:30.",
      audio: [{ data: "AQIDBA==", mimeType: "audio/pcm;rate=24000" }],
      language: "en",
    };
    const approvedArabicOutput: ApprovedOutput = {
      transcript: "تم حجز موعدك يوم الثلاثاء الساعة العاشرة والنصف.",
      audio: [{ data: "BQYHCA==", mimeType: "audio/pcm;rate=24000" }],
      language: "ar",
    };
    act(() => {
      callbacks?.onPatientTranscript?.("Book Tuesday morning.", true, "text");
      callbacks?.onAssistantTranscript?.(approvedOutput.transcript, approvedOutput.language);
      callbacks?.onApprovedOutput?.(approvedOutput, vi.fn(), vi.fn());
      callbacks?.onAssistantTranscript?.(approvedArabicOutput.transcript, approvedArabicOutput.language);
      callbacks?.onApprovedOutput?.(approvedArabicOutput, vi.fn(), vi.fn());
      callbacks?.onAssistantTranscript?.("We can try again.", "en", true);
    });

    expect(screen.getAllByRole("button", { name: "Replay audio" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "إعادة تشغيل الرد الصوتي" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Replay audio" }));
    await user.click(screen.getByRole("button", { name: "إعادة تشغيل الرد الصوتي" }));

    expect(audioPlayer.play).toHaveBeenCalledTimes(4);
    expect(audioPlayer.play).toHaveBeenNthCalledWith(3, approvedOutput, expect.any(Function), expect.any(Function));
    expect(audioPlayer.play).toHaveBeenNthCalledWith(4, approvedArabicOutput, expect.any(Function), expect.any(Function));
    expect(session.sendText).not.toHaveBeenCalled();
  });

  it("waits for the live reply to finish before allowing replay", async () => {
    const user = userEvent.setup();
    let callbacks: SessionControllerCallbacks | undefined;
    let finishPlayback: (() => void) | undefined;
    const audioPlayer = {
      prepare: vi.fn(async () => undefined),
      setMuted: vi.fn(),
      play: vi.fn(async (_output: ApprovedOutput, complete: () => void) => { finishPlayback = complete; }),
      stop: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    render(
      <App
        createSessionController={(nextCallbacks) => {
          callbacks = nextCallbacks;
          return {
            connect: vi.fn(async () => undefined),
            beginMicrophoneTurn: vi.fn(() => 1),
            sendMicrophoneAudio: vi.fn(),
            endMicrophoneStream: vi.fn(),
            sendText: vi.fn(() => true),
            stop: vi.fn(async () => undefined),
          };
        }}
        audioPlayer={audioPlayer}
      />,
    );

    const output: ApprovedOutput = {
      transcript: "Your appointment is booked.",
      audio: [{ data: "AQIDBA==", mimeType: "audio/pcm;rate=24000" }],
      language: "en",
    };
    act(() => {
      callbacks?.onAssistantTranscript?.(output.transcript, output.language);
      callbacks?.onApprovedOutput?.(output, vi.fn(), vi.fn());
    });

    const replayButton = screen.getByRole("button", { name: "Replay audio" });
    expect(replayButton).toBeDisabled();
    await user.click(replayButton);
    expect(audioPlayer.play).toHaveBeenCalledOnce();

    act(() => finishPlayback?.());
    expect(replayButton).toBeEnabled();
    await user.click(replayButton);
    expect(audioPlayer.play).toHaveBeenCalledTimes(2);
  });

  it("stops the microphone when the Live session disconnects", async () => {
    let callbacks: SessionControllerCallbacks | undefined;
    const session: SessionControllerApi = {
      connect: vi.fn(async () => callbacks?.onState?.("connected")),
      beginMicrophoneTurn: vi.fn(() => 1),
      sendMicrophoneAudio: vi.fn(),
      endMicrophoneStream: vi.fn(),
      sendText: vi.fn(() => true),
      stop: vi.fn(async () => undefined),
    };
    const capture = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    render(
      <App
        createSessionController={(nextCallbacks) => {
          callbacks = nextCallbacks;
          return session;
        }}
        createMicrophoneCapture={() => capture}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Start session" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Start microphone" }));
    expect(capture.start).toHaveBeenCalledOnce();
    act(() => callbacks?.onState?.("error", "The voice connection closed."));

    await waitFor(() => expect(capture.stop).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "Stop microphone" })).not.toBeInTheDocument();
  });

  it("records transcript, session, tool, audio-check, and playback events with copy and clear controls", async () => {
    const user = userEvent.setup();
    let callbacks: SessionControllerCallbacks | undefined;
    let failPlayback: ((error: Error) => void) | undefined;
    const audioPlayer = {
      prepare: vi.fn(async () => undefined),
      setMuted: vi.fn(),
      play: vi.fn(async (_output: ApprovedOutput, _complete: () => void, failed: (error: Error) => void) => {
        failPlayback = failed;
      }),
      stop: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    const clipboardWriteText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
    render(
      <App
        createSessionController={(nextCallbacks) => {
          callbacks = nextCallbacks;
          return {
            connect: vi.fn(async () => undefined),
            beginMicrophoneTurn: vi.fn(() => 1),
            sendMicrophoneAudio: vi.fn(),
            endMicrophoneStream: vi.fn(),
            sendText: vi.fn(() => true),
            stop: vi.fn(async () => undefined),
          };
        }}
        audioPlayer={audioPlayer}
      />,
    );

    act(() => {
      callbacks?.onState?.("connected");
      callbacks?.onPatientTranscript?.("Can I book with Dr. Khalid?", true, "microphone");
      callbacks?.onAssistantTranscript?.("Sure, which day works for you?", "en");
      callbacks?.onToolResult?.({ toolName: "get_available_slots", status: "ok" });
      callbacks?.onOutputRejected?.({ reason: "missing_audio", safeText: "private verifier text" });
      callbacks?.onApprovedOutput?.({
        transcript: "The reply passed verification.",
        audio: [{ data: "AQID", mimeType: "audio/pcm;rate=24000" }],
        language: "en",
      }, vi.fn(), vi.fn());
    });
    act(() => failPlayback?.(new Error("browser playback detail")));

    const testLogSummary = screen.getByText("Test log · 7 events");
    expect(testLogSummary.closest("details")).not.toHaveAttribute("open");
    const summary = screen.getByText(/Test log/);
    await user.click(summary);
    expect(screen.getByText("Session: connected")).toBeInTheDocument();
    expect(screen.getByText(/Patient \(microphone\): Can I book with Dr\. Khalid\?/)).toBeInTheDocument();
    expect(screen.getByText(/Agent: Sure, which day works for you\?/)).toBeInTheDocument();
    expect(screen.getByText(/Tool get_available_slots → ok/)).toBeInTheDocument();
    expect(screen.getByText(/Audio check withheld: missing_audio/)).toBeInTheDocument();
    expect(screen.getByText("Audio check passed.")).toBeInTheDocument();
    expect(screen.getByText(/Playback failed/)).toBeInTheDocument();
    expect(screen.queryByText("private verifier text")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy log" }));
    expect(clipboardWriteText).toHaveBeenCalledOnce();
    expect(clipboardWriteText.mock.calls[0]?.[0]).toContain("Tool get_available_slots → ok");
    expect(screen.getByText("Log copied.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear log" }));
    expect(screen.getByText("No events logged yet.")).toBeInTheDocument();
    expect(localStorage.getItem("health-voice-agent:test-log:v1")).toBeNull();
  });

  it("restores the test log after the app is remounted", () => {
    let callbacks: SessionControllerCallbacks | undefined;
    const app = render(<App createSessionController={(nextCallbacks) => {
      callbacks = nextCallbacks;
      return {
        connect: vi.fn(async () => undefined),
        beginMicrophoneTurn: vi.fn(() => 1),
        sendMicrophoneAudio: vi.fn(),
        endMicrophoneStream: vi.fn(),
        sendText: vi.fn(() => true),
        stop: vi.fn(async () => undefined),
      };
    }} />);

    act(() => callbacks?.onPatientTranscript?.("Keep this test turn", true, "text"));
    app.unmount();

    render(<App createSessionController={() => ({
      connect: vi.fn(async () => undefined),
      beginMicrophoneTurn: vi.fn(() => 1),
      sendMicrophoneAudio: vi.fn(),
      endMicrophoneStream: vi.fn(),
      sendText: vi.fn(() => true),
      stop: vi.fn(async () => undefined),
    })} />);
    fireEvent.click(screen.getByText(/Test log/));

    expect(screen.getByText(/Patient \(text\): Keep this test turn/)).toBeInTheDocument();
  });

  it("does not show or store diagnostics when development logging is disabled", () => {
    let callbacks: SessionControllerCallbacks | undefined;
    render(<App showDiagnostics={false} createSessionController={(nextCallbacks) => {
      callbacks = nextCallbacks;
      return {
        connect: vi.fn(async () => undefined),
        beginMicrophoneTurn: vi.fn(() => 1),
        sendMicrophoneAudio: vi.fn(),
        endMicrophoneStream: vi.fn(),
        sendText: vi.fn(() => true),
        stop: vi.fn(async () => undefined),
      };
    }} />);

    act(() => {
      callbacks?.onState?.("connected");
      callbacks?.onPatientTranscript?.("Private demo utterance", true, "text");
    });

    expect(screen.queryByText(/Test log/)).not.toBeInTheDocument();
    expect(localStorage.getItem("health-voice-agent:test-log:v1")).toBeNull();
  });
});
