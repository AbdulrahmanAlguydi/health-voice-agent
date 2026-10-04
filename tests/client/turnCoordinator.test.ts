import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnCoordinator } from "../../src/client/agent/turnCoordinator";

describe("TurnCoordinator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows interim transcript but does not treat it as final confirmation evidence", async () => {
    const turns = new TurnCoordinator({ now: () => 1_000 });
    const id = turns.beginTurn("microphone");
    turns.updateTranscript("yes", false, id);

    expect(turns.currentTranscript()).toMatchObject({ text: "yes", final: false });
    expect(turns.completedConfirmationTranscript()).toBeUndefined();
  });

  it("accepts only the finalized transcript from the current input turn", async () => {
    const turns = new TurnCoordinator({ now: () => 1_000 });
    const oldTurn = turns.beginTurn("microphone");
    turns.updateTranscript("yes", true, oldTurn);
    const currentTurn = turns.beginTurn("microphone");

    expect(turns.completedConfirmationTranscript()).toBeUndefined();
    turns.updateTranscript("yes please", true, currentTurn);
    expect(turns.completedConfirmationTranscript()).toEqual("yes please");
  });

  it("waits briefly when a confirm tool call arrives before final transcription", async () => {
    const turns = new TurnCoordinator({ now: () => 1_000, confirmationWaitMs: 500 });
    const id = turns.beginTurn("microphone");
    turns.updateTranscript("yes", false, id);
    const pending = turns.waitForConfirmationTranscript();

    turns.updateTranscript("yes, please", true, id);
    await expect(pending).resolves.toEqual("yes, please");
  });

  it("fails closed when transcript times out or a newer turn supersedes the old one", async () => {
    const turns = new TurnCoordinator({ now: () => 1_000, confirmationWaitMs: 500 });
    turns.beginTurn("microphone");
    const timedOut = turns.waitForConfirmationTranscript();
    await vi.advanceTimersByTimeAsync(501);
    await expect(timedOut).resolves.toBeUndefined();

    const id = turns.beginTurn("microphone");
    const superseded = turns.waitForConfirmationTranscript();
    turns.beginTurn("microphone");
    turns.updateTranscript("yes", true, id);
    await expect(superseded).resolves.toBeUndefined();
  });

  it("uses the exact sent text as finalized evidence for typed turns", () => {
    const turns = new TurnCoordinator({ now: () => 1_000 });
    turns.beginTypedTurn("Yes, please book it.");

    expect(turns.completedConfirmationTranscript()).toBe("Yes, please book it.");
  });

  it("does not reuse the patient's initial booking request as consent after read-back", async () => {
    const turns = new TurnCoordinator();
    turns.beginTypedTurn("Book Dr Smith at 10, please.");
    turns.invalidateCurrentTurn();

    await expect(turns.waitForConfirmationTranscript()).resolves.toBeUndefined();
  });

  it("rejects stale confirmations", () => {
    let now = 1_000;
    const turns = new TurnCoordinator({ now: () => now, confirmationEvidenceMaxAgeMs: 5_000 });
    const id = turns.beginTurn("microphone");
    turns.updateTranscript("yes", true, id);
    now = 20_000;

    expect(turns.completedConfirmationTranscript()).toBeUndefined();
  });
});
