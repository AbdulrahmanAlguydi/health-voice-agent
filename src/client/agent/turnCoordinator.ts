export type InputTurnSource = "microphone" | "text";

export type FinalTranscriptEvent = { turnId: number; source: InputTurnSource; text: string };

type InputTurn = {
  id: number;
  source: InputTurnSource;
  text: string;
  final: boolean;
  startedAt: number;
  consumed: boolean;
};

type PendingConfirmationWaiter = {
  turnId: number;
  resolve: (transcript: string | undefined) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type TurnCoordinatorOptions = {
  now?: () => number;
  confirmationWaitMs?: number;
  confirmationEvidenceMaxAgeMs?: number;
};

export class TurnCoordinator {
  private readonly now: () => number;
  private readonly confirmationWaitMs: number;
  private readonly confirmationEvidenceMaxAgeMs: number;
  private nextId = 0;
  private current?: InputTurn;
  private waiter?: PendingConfirmationWaiter;
  private readonly finalTranscriptListeners = new Set<(event: FinalTranscriptEvent) => void>();

  constructor(options: TurnCoordinatorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.confirmationWaitMs = options.confirmationWaitMs ?? 1_800;
    this.confirmationEvidenceMaxAgeMs = options.confirmationEvidenceMaxAgeMs ?? 20_000;
  }

  beginTurn(source: InputTurnSource): number {
    this.resolveWaiter(undefined);
    const id = ++this.nextId;
    this.current = {
      id,
      source,
      text: "",
      final: false,
      startedAt: this.now(),
      consumed: false,
    };
    return id;
  }

  /** Invalidates the initiating request so it cannot also approve the later read-back. */
  invalidateCurrentTurn(): void {
    this.resolveWaiter(undefined);
    this.current = undefined;
  }

  beginTypedTurn(text: string): number {
    const id = this.beginTurn("text");
    this.updateTranscript(text, true, id);
    return id;
  }

  updateTranscript(text: string, final: boolean, turnId = this.current?.id): void {
    const turn = this.current;
    if (!turn || turnId === undefined || turn.id !== turnId || turn.consumed) return;
    if (turn.final && (!final || turn.text !== text.trim())) return;
    turn.text = text.trim();
    turn.final = final;
    if (final) {
      const event = { turnId: turn.id, source: turn.source, text: turn.text };
      for (const listener of this.finalTranscriptListeners) listener(event);
      if (this.waiter?.turnId === turn.id) this.resolveWaiter(this.readFreshFinal(turn));
    }
  }

  onFinalTranscript(listener: (event: FinalTranscriptEvent) => void): () => void {
    this.finalTranscriptListeners.add(listener);
    return () => this.finalTranscriptListeners.delete(listener);
  }

  currentTranscript(): { id: number; source: InputTurnSource; text: string; final: boolean } | undefined {
    if (!this.current) return undefined;
    const { id, source, text, final } = this.current;
    return { id, source, text, final };
  }

  completedConfirmationTranscript(): string | undefined {
    return this.current ? this.readFreshFinal(this.current) : undefined;
  }

  /**
   * Returns only completed evidence from the input turn currently being handled.
   * A timeout or a newer patient turn resolves to undefined, never to older text.
   * Successful retrieval consumes the evidence so it cannot authorize another write.
   */
  waitForConfirmationTranscript(timeoutMs = this.confirmationWaitMs): Promise<string | undefined> {
    const turn = this.current;
    if (!turn || turn.consumed) return Promise.resolve(undefined);
    const final = this.readFreshFinal(turn);
    if (final !== undefined) {
      turn.consumed = true;
      return Promise.resolve(final);
    }
    if (this.waiter) return Promise.resolve(undefined);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.waiter?.turnId !== turn.id) return;
        this.waiter = undefined;
        resolve(undefined);
      }, timeoutMs);
      this.waiter = { turnId: turn.id, resolve, timeout };
    });
  }

  private readFreshFinal(turn: InputTurn): string | undefined {
    if (!turn.final || turn.consumed || !turn.text) return undefined;
    if (this.now() - turn.startedAt > this.confirmationEvidenceMaxAgeMs) return undefined;
    return turn.text;
  }

  private resolveWaiter(transcript: string | undefined): void {
    const waiter = this.waiter;
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    this.waiter = undefined;
    if (transcript !== undefined && this.current?.id === waiter.turnId) this.current.consumed = true;
    waiter.resolve(transcript);
  }
}
