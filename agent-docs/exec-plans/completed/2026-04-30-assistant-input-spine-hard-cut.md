# Assistant Input Spine Hard Cut

## Goal

Make assistant input the only Codex-critical path for both local and hosted runtime:

1. Source adapters write `AssistantInputEvent`.
2. Scanner and active-turn admission read from `AssistantInputSource`.
3. Accepted-input journal records `assistant-input-event`.
4. Inbox remains a projection/enrichment surface, not a turn-admission gate.
5. Rapid conversation messages are batched into the next turn without loss.

The concrete reliability target for this pass is that five messages arriving about three seconds apart are all staged as assistant input and folded into the next scanner or active-turn refresh, even if inbox projection is delayed or fails.

## Constraints

- Keep hosted as a thin runner over the local assistant runtime.
- Do not add a second runtime journal or hosted-only assistant path.
- Prefer deleting old capture-gated branches over adding compatibility layers.
- Preserve unrelated dirty-tree work.
- Do not expose personal identifiers, raw provider payloads, secrets, or full authorization headers in docs, tests, prompts, or logs.
- Keep workspace package dependencies one-way and through public entrypoints.

## Target Shape

The desired spine is:

```text
source adapter -> AssistantInputEvent -> AssistantInputSource -> scanner / active turn -> accepted-input journal -> Codex
```

Inbox still has value, but only after admission:

- query/search projection,
- durable capture ledger for inbox UI,
- attachment/parser enrichment,
- display and debugging context,
- retryable projection work.

Inbox must not decide whether Codex sees a valid decoded conversation message.

## Bugs To Fix

1. Hosted scanner can still fall back to inbox-backed input when an explicit source is missing.
2. Local automation still creates capture-shaped accepted input through the inbox-backed source.
3. Direct auto-reply helper still scans `inboxServices.list`.
4. Hosted raw email missing can advance mailbox import despite not having assistant-ready content.
5. Linq/Telegram/email external identifiers can pass through safe-looking token filters instead of being hashed.
6. Active-turn input checkpoint can clear scheduled wake fields.
7. Runtime-only inbox projection remains as an old admission workaround.

## Implementation Plan

1. Require a real `AssistantInputSource` at scanner boundaries.
   - Remove hidden scanner fallback to `createInboxBackedAssistantInputSource`.
   - Make run-loop construct the store-backed source for both hosted and local runtime unless a caller supplies one.
   - Delete or rebase the old direct `scanAssistantAutoReplyOnce` helper that enumerates inbox captures.

2. Make hosted turn input store-backed by default.
   - `createHostedAssistantInputSource` should always return a store-backed source.
   - Active-turn refresh/checkpoint hooks are attached only when both hosted active-turn ports exist.
   - A partial hook set is a configuration error.

3. Fix hosted mailbox no-loss cases.
   - Stage assistant input before inbox projection.
   - Treat missing raw hosted email content as retryable unless the mailbox event already carries assistant-ready content.
   - Hash external provider/account/thread/actor identifiers in assistant input metadata.
   - Preserve scheduled wake fields when checkpointing active-turn input acceptance.

4. Remove runtime-only inbox admission support.
   - Delete public `includeRuntimeOnly` options and runtime-only persistence modes.
   - Keep inbox canonical projection and search behavior.
   - Remove tests that assert runtime-only rows are queryable.

5. Prove rapid-message behavior.
   - Add focused coverage that multiple staged conversation inputs after the prior cursor are returned together.
   - Add hosted active-turn or scanner coverage for repeated mailbox messages being accepted without capture projection.
   - Ensure duplicate retries do not produce duplicate accepted input after checkpoint.

6. Refresh durable docs.
   - Update architecture docs to describe the single assistant input spine.
   - Remove stale runtime-only inbox wording.
   - Document that hosted runner is a containerized runner over the same local runtime input spine.

## Verification

Run focused checks for touched packages:

- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/inboxd typecheck`
- focused assistant-engine Vitest for input source, automation scanner/runtime, and accepted-input journal behavior
- focused assistant-runtime Vitest for mailbox conversation import, turn input, workspace runner, and mailbox import behavior
- focused inboxd Vitest for canonical projection/search behavior
- `git diff --check`

If broader repo checks fail because of unrelated active rows, record the exact failing command and why this diff does not own it.

Executed:

- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir packages/inboxd typecheck` passed.
- `pnpm --dir packages/inbox-services typecheck` passed.
- `pnpm --dir packages/assistant-cli typecheck` passed.
- `pnpm --dir packages/assistant-engine test` passed.
- `pnpm --dir packages/assistant-runtime test` passed.
- Focused inboxd, inbox-services, and assistant-cli Vitest commands passed for the touched seams.
- Scoped `git diff --check` passed for this plan's files.

Key regressions covered:

- Five hosted Linq messages arriving three seconds apart stage as assistant input and are returned together to scanner and active-turn input even when capture projection fails.
- Local inbox `capture.imported` events stage `AssistantInputEvent` before the wake-driven scan.
- Auto-reply recovery and accepted-input journaling require `assistant-input-event` identities instead of falling back to inbox capture ids.
- Runtime-only inbox list/show/admission support is removed from public app reads and hosted automation.

## Completion Audits

Before handoff, run the required workflow audits for this high-risk cross-cutting refactor:

- security/privacy review,
- coverage-write review,
- simplify review,
- task-finish review.
Status: completed
Updated: 2026-04-30
Completed: 2026-04-30
