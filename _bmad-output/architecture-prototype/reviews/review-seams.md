# Architecture gate — adversarial seam review

Verdict: PASS after scoped fixes. Both original P2 findings below are resolved. The durable approval/result transaction is appropriately scoped for this prototype; neither finding required a server-owned conversation workflow.

## Resolution review — 2026-10-02

The reconnect predicate now includes `pendingIdentityId`, `bookingIntentActive`, and `guestPath`, so retained early intake enters the structured recovery branch. The tool wrapper now tracks dispatched operations in an `inFlight` set; explicit `cancelPending()` awaits them before reconciling unknown confirmation outcomes and clearing/cancelling domain state. This closes the late-prepare race because stop observes and cancels the returned handle before it completes. Unexpected transport close still preserves domain state.

I inspected the updated implementation and the composed regression cases, and independently ran `npm test -- tests/client/semantic-booking-actions.test.ts tests/client/live-session.test.ts`: 2 files and 47 tests passed. These cover early guest reconnect, delayed preparation versus stop, and reconciliation of a lost successful commit before stop. No additional blocking correctness gap was found in these two fixes. The parent agent reports the full 491-test suite and build passing; this reviewer independently verified only the focused 47-test run.

## 1. Retained intake state can reconnect through the fresh-opening branch

Severity: P2. Rule: AD-3.

The tool adapter retains `bookingIntentActive`, `guestBookingPathSelected`, and pending identity state on transport failure, and exposes them in `getBookingContext()` (`src/client/agent/tools.ts:774`). The voice adapter independently chooses a recovery opening only for a pending booking, a completed booking, a verified patient, or available slot IDs (`src/client/voice/session.ts:175–177`). Those ownership decisions conflict at the recovery boundary.

Concrete reproduction: call `begin_booking` with `continueWithoutPatientId: true` before any availability lookup. The response explicitly selects the guest path and says to find the doctor without asking for patient ID again (`tools.ts:375–384`). Lose the voice connection, then reconnect. Local guest intent survives, but all four recovery-opening predicates are false, so the provider receives a new Arabic greeting instead of the structured state. The same mismatch is possible for a pending identity lookup before availability. This is an intake restart despite retained state.

Small correction: define a single explicit recoverable-domain-state predicate that includes intake intent, guest path, and pending identity state, and use it for connection opening. Add one fake-provider regression that disconnects after guest-path selection with no availability and asserts the next opening contains recovery JSON and the selected guest path.

## 2. Explicit stop and a late prepare response disagree about draft lifetime

Severity: P2. Rule: AD-3; also the stop verification boundary in AD-5.

`stop()` invalidates the connection and awaits `cancelPending()` (`src/client/voice/session.ts:298–310`). `cancelPending()` clears local intake and cancels only the pending ID currently known to the adapter (`src/client/agent/tools.ts:792–820`). Meanwhile, a dispatched prepare request may still be waiting for its HTTP response; its success handler assigns the returned ID and summary unconditionally (`tools.ts:630–640`, with the corresponding registered-patient prepare branch doing the same). The voice layer checks session identity after awaiting the tool, but that check only suppresses delivery: it does not undo the tool's domain mutation.

Concrete reproduction: pause a successful `/api/bookings/prepare-guest` response after the server creates the draft. Explicitly stop while the browser still has no pending ID. Stop finishes and reports `ended`. Release the prepare response. The old tool call now restores `pendingId` and the summary into the stopped adapter, while the server draft remains live until expiration. The next connection sees that ID and resumes a draft the caller explicitly abandoned. A transport attempt guard and a tool-state cleanup are each locally reasonable, but their asynchronous ordering leaves this shared state inconsistent.

Small correction: give draft-producing tool work a local cancellation generation or equivalent lifecycle boundary. A late prepare response belonging to an explicitly stopped generation must be discarded and its newly returned pending handle cancelled. Preserve the existing distinction that an unexpected transport close does not cancel domain work. Add a deferred-fetch regression covering prepare → explicit stop → late pending response → reconnect; assert no recoverable draft and no confirmation mutation. This does not require aborting or reclassifying an already approved commit.

## Approval, unknown outcomes, and expiration

The main cross-layer contract is coherent on inspection: the client retains the pending handle plus original transcript while confirmation outcome is unknown, blocks new mutations, and retries the same approve request; the service checks persisted successful results before consulting the in-memory draft or its TTL. Thus a lost committed response can be recovered after expiration/restart, while an uncommitted expired or missing draft produces an explicit terminal response. Explicit stop attempts that reconciliation before clearing state. These are positive findings, not certification of live-provider behavior.

Initial review method: static source tracing of the spine and the three scoped components. No app source was edited. The initial regression recipes above identified missing seam assertions rather than claiming observed test failures; the subsequent resolution review includes the focused test execution recorded above.
