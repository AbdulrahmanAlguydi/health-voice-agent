# Architecture alternatives — rubric and input reconciliation

Reviewed 2026-10-02: `architecture-alternatives.md`, `comparison.md`, `docs/superpowers/specs/2026-10-02-appointment-workflow-replacement-design.md`, and the original attached `Pasted text.txt`. Design-only review; no runtime or design files changed.

Final verdict: pass for the design-only prototype architecture choice. Resource-centered domain functions are credible and proportionate. The proposal preserves the intended scope and separates target behavior from implementation. The medium emergency/lifecycle seam is resolved; no critical, high or medium rubric findings remain.

## Resolved medium — Emergency override did not bind in-flight uncommitted writes

AD-7 requires stopping **new** routine writes on a current emergency. The source design requires preserving saved results and stopping **unfinished** routine writes. AD-6 supplies serialized lifecycle and terminal-session protections, but explicitly binds those protections only to ending the session. Two implementations could therefore diverge: one marks the emergency within the session mutation boundary and rejects pending uncommitted operations; another merely stops asking for new operations while a delayed prepared booking later commits.

Recommended correction: state that entering an emergency phase shares the serialized session mutation boundary and blocks/abandons uncommitted routine operations, including previously prepared operations. Check that state when entering the commit transaction. Already committed operations retain their result and reconcile truthfully. A corrected misrecognition may restore the retained noncommitted context under a new valid revision. This is one extension to the existing rule, not a queue, workflow engine or new architecture.

Resolution checked against the source: AD-6 now binds explicit end and emergency override to the same serialized admission boundary, checks active status inside commit, rejects delayed uncommitted requests, preserves retrievable committed results, and permits correction under a fresh revision. Emergency preserves paused intake details while invalidating uncommitted consent/operations. The comparison carries the same semantics. This closes the divergence without adding infrastructure or making implementation claims.

The revised AD-3 also distinguishes offer issuance from actual output exposure and binds acceptance to the offer, producing output and subsequent caller turn. It explicitly avoids exact-caption/full-playback gates and treats uncertain exposure as clarification context. Subject identity and contact-format conventions narrow previously deferred choices consistently with the source design. These changes preserve flexible conversation and one accepted offer rather than restoring legacy sentence matching.

## Input reconciliation

| Input concern | Assessment |
| --- | --- |
| Urban Hejazi / English and stable native voice | Explicitly selected; actual listening remains the acceptance evidence, with no claim of guaranteed accent. |
| Flexible intake, one slot acceptance, separate dictated-phone confirmation | Captured by domain resources, immutable offers, separate revisions and missing-field results. No mandatory patient-ID path or second conversational controller. |
| Partial/corrected/grouped phone digits | Server capture, event deduplication, versions, digit count and no trimming/padding preserve the important original-prompt behavior. |
| Grounded knowledge, services, availability and dates | Compact versioned database facts plus detailed/current queries and injected Riyadh clock match the source. Caller preferences cannot silently override facts. |
| Proxy/family, existing lookup/move/cancel, waitlist/callback | Capability map and comparison retain these, with sequential independent results, active occupancy and stable appointment identity. Exact schemas remain a stated next-plan task. |
| Clinical content and emergency routing | Comparison explicitly limits summary links to simulations with no clinical content; routing is administrative and bounded. Nearest real hospital emergency department replaces copied clinic destination/number assumptions. Revised AD-6 closes the in-flight override seam. |
| Prompt adaptation | No copied doctor records, 1,826-service catalog, preplayed greeting, exact ordinary replies, hardcoded clock or invented Saudi data-residency claim. Useful behavioral intent is retained. |
| Direct audio and UI history/replay | Thin browser media ownership and native streaming remain; replay cannot execute tools. Source UI requirements remain binding rather than being redefined by the architecture. |
| Existing app preservation | Separate replacement database, source/untracked-file/consistent-DB backup and one authoritative path per session are explicit. The comparison truthfully says backups and runtime replacement have not occurred. |
| Testing and uncertainty | Domain effects, event ordering, repeated live conversations and actual audio evaluation remain separate evidence; no error-rate or latency benchmark is invented. |

## Good-spine rubric

The named paradigm, eight decisions and consistency conventions address the main independent-build divergences: dialogue/domain ownership, approval identity, contact repair, revisions, occupancy, atomic result persistence, reconnect/end ordering, grounding and validation evidence. The architecture stays within the local React/Express/SQLite/Gemini envelope. Alternative speech pipelines, relays and frameworks have measured revisit conditions rather than speculative adoption.

Operational/environmental dimensions are present: local single-process deployment, provider capability probes, durable application-context reconstruction, bounded retries, diagnostics, migration isolation and test tiers. Deferred exact contracts and timeouts do not imply implementation readiness; the spine explicitly requires a focused plan before implementation. Those contracts must preserve the stated ownership/version/operation invariants.

The design is clearly marked target-only. Statements about current fixes being retained are architectural inheritance, not a claim that the replacement domain resources exist. No proposed decision weakens the prototype's durable-result or transport-is-not-cancellation guarantees.

The comparison includes primary-provider references and clearly labels the alternative comparison as qualitative judgment. This rubric review did not independently revalidate external documentation or provider capabilities; the exact-model/token probes remain a prerequisite as written.

No application tests were run for this design-only review: runtime test results would not verify the proposed resource/consent contracts. The required first vertical slice and subsequent live/listening acceptance remain implementation work.
