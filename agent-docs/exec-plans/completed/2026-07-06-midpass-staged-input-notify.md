Goal (incl. success criteria):
- A conversation mailbox item imported while an assistant turn is running must notify the active turn as soon as its assistant input is staged, instead of only after local-inbox projection and the full import call complete.
- Success is a focused regression test proving the active-turn notify observably fires before projection completes for a non-replay conversation import, with import outcome semantics (including parser-retry blocked) unchanged.

Constraints/Assumptions:
- Minimal complexity: no new state owners, queues, schedulers, or effect kinds. This is a reorder plus at most one small shared helper.
- Do not touch `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts` or `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` / `hosted-runtime-workspace-runner.test.ts` — an active Codex lane (Foreground mailbox system-failure isolation) owns them right now.
- Projection (`projectHostedConversationAssistantInputBestEffort`) stays awaited inline; its outcome semantics (parserRetry -> blocked, projection reason codes) are unchanged.
- Early notify is best-effort: failures must not fail or delay the import.
- Skip the early notify for durably-consumed replays (`input.item.durablyConsumed === true`), mirroring the staged-latency-trace guard.

Key decisions:
- Prod evidence (2026-07-06 incident, member hbm_Yo0R2KOKQsR94D0M seq 1055): wake reached the foreground loop in 1ms; input staged at 22:06:19.3, 2.6s after the running codex turn began; but the active-turn notify only fired when the whole import call returned at 22:06:38.6 (after ~19s of local-inbox projection), 1.3s before turn end — fold-in missed, reply slipped a full pass (77s total). Staging is sufficient for turn admission; projection is enrichment (hosted-runtime-protocol.md:528-570, invariants Foreground mailbox priority).
- Notify point: inside `importHostedConversationMailboxItem` immediately after `stageAssistantInputEvent` + staged-trace record, before projection.
- Reuse, don't duplicate: the conversation-ref derivation and notify already exist in workspace-runner's `notifyHostedActiveTurnInputForMailboxImport`. Prefer extracting a small `notifyAssistantActiveTurnInputAvailableForInputIds`-style helper into the module that owns the notify (assistant-engine active-turn-input-controller) or a shared hosted-runtime module, so both call sites share one derivation. If layering resists, a local best-effort read of the staged event by `stagedInput.inputId` in mailbox-conversation-import is acceptable; do not import from workspace-runner.
- The later runner-level notify after the import call stays; `notifyInputAvailable` admission is idempotent against staged/consumed state.

State:
- Done.

Done:
- Investigation, prod trace decomposition, Codex await-inventory, and safety case for staging-time notify.
- Implemented shared `notifyAssistantActiveTurnInputAvailableForInputIds` (assistant-engine owns derivation + best-effort notify); early notify after non-replay staging in `importHostedConversationMailboxItem`; workspace-runner notify collapsed to delegate (net deletion).
- Regression tests: notify-before-projection ordering with a real registered active-turn controller and production Linq conversation-key derivation; durably-consumed replay does not early-notify; notify failure leaves the import outcome `imported`.
- Verified: focused conversation-import tests (54), workspace entrypoint + runner tests (241), active-turn journal + local-service runtime tests (113), assistant-runtime and assistant-engine typechecks.
- Codex deep-review round: zero Critical/High/Medium; verdict LAND. One Low (add an end-to-end staged-input → answeredMailboxItemIds → consumedAt regression) considered and not actioned: the reviewer's own trace confirms that chain in production code, the new ordering test already pins the staged input id and mailbox item id on the import outcome, and delivery idempotency / consumed-replay skip have their own suites.

Now:
- Ready to commit and open the PR.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-engine/src/assistant/active-turn-input-controller.ts` (only if the shared-helper shape is chosen)
- `packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
