// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Transcript, type ConversationMessage } from "../../src/client/components/Transcript";

afterEach(cleanup);

it("keeps the newest patient and assistant bubbles visible without losing earlier messages or focus", () => {
  const first: ConversationMessage = { id: 1, role: "patient", text: "أبي موعد", language: "ar" };
  const props = { replayDisabled: false, onReplayAudio: () => undefined };
  const view = render(<><input aria-label="Test input" /><Transcript {...props} messages={[first]} /></>);
  const log = screen.getByRole("log");
  // jsdom has no layout. Supply the browser's measured content height;
  // scrollTop is a real DOM property, not a mocked scrolling function.
  Object.defineProperty(log, "scrollHeight", { configurable: true, value: 500 });
  const input = screen.getByRole("textbox"); input.focus();
  view.rerender(<><input aria-label="Test input" /><Transcript {...props} messages={[first,
    { id: 2, role: "assistant", text: "أي طبيب؟", language: "ar" }]} /></>);
  expect(log.scrollTop).toBe(500);
  expect(screen.getByText("أبي موعد")).toBeInTheDocument();
  expect(input).toHaveFocus();
  log.scrollTop = 0;
  view.rerender(<><input aria-label="Test input" /><Transcript {...props} messages={[first,
    { id: 2, role: "assistant", text: "أي طبيب؟", language: "ar" },
    { id: 3, role: "patient", text: "ندى الخطيب", language: "ar" }]} /></>);
  expect(log.scrollTop).toBe(500);
  expect(screen.getByText("أي طبيب؟")).toBeInTheDocument();
});

it("follows growing live transcription before a finished bubble is appended", () => {
  const props = { messages: [], replayDisabled: false, onReplayAudio: () => undefined };
  const view = render(<Transcript {...props} partial={{ text: "Hello", language: "en" }} />);
  const log = screen.getByRole("log");
  Object.defineProperty(log, "scrollHeight", { value: 750 });
  view.rerender(<Transcript {...props} partial={{ text: "Hello, what times are available?", language: "en" }} />);
  expect(log.scrollTop).toBe(750);
  expect(screen.getByText("Hello, what times are available?")).toBeInTheDocument();
});
