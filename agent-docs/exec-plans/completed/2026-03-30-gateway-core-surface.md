# 2026-03-30 Gateway Core Surface

## Goal

- Land the smallest safe step-2 extension on top of the existing `murph/gateway-core` contract freeze: a local derived read projection plus read-only `assistantd` gateway routes.

## Scope

- `agent-docs/exec-plans/active/2026-03-30-gateway-core-surface.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `ARCHITECTURE.md`
- `packages/cli/src/{gateway-core.ts,gateway/**,assistant/outbox.ts}`
- `packages/cli/test/{gateway-core.test.ts,gateway-local-service.test.ts}`
- `packages/assistantd/src/{service.ts,http.ts}`
- `packages/assistantd/test/{assistant-core-boundary.test.ts,http.test.ts}`

## Progress Snapshot

- Step 1 is already landed in the live tree: `murph/gateway-core` exists as a transport-neutral contract surface.
- This plan tracks Step 2: a local derived read projection plus read-only `assistantd` routes over that surface.
- Step 3 remains out of scope for this turn: send/events/permissions plus hosted Cloudflare and MCP adapters.

## Why This Step

- Vault truth remains canonical.
- The gateway surface should be an explicitly derived operational read model over inbox captures, assistant sessions, and sent outbox intents, not a second source of truth.
- `assistantd` is the right local trust boundary for serving transport-facing reads without moving canonical writes out of CLI/core ownership.

## Intended Landing

- Add opaque transport-facing conversation, message, and attachment ids derived from stable route keys.
- Add a local read model derived from inbox captures, assistant session bindings, and sent outbox intents.
- Add read-only `assistantd` routes for conversation list/get, message read, and attachment fetch.
- Keep events, permissions, and send behavior as explicit follow-up work rather than speculative partial implementations.

## Constraints

- Preserve unrelated dirty worktree edits and overlapping active lanes.
- Treat the supplied patch as behavioral intent rather than blindly applying it to the live tree.
- Keep the gateway plane derived and operational only; do not introduce new canonical persistence.

## Plan

1. Restore the missing step-2 plan file and update the coordination ledger row to reflect the real scope.
2. Port the gateway local-service, opaque-id helpers, and route helpers onto the current `packages/cli` step-1 surface.
3. Wire `assistantd` to the new local gateway service and expose only the read-only routes.
4. Add focused regression coverage for the projection behavior and the daemon HTTP boundary.
5. Run required verification, then the mandatory simplify and task-finish-review audit passes.

## Verification

- Passed: `pnpm --dir packages/cli build`
- Passed: `pnpm --dir packages/assistantd build`
- Passed: `pnpm --dir packages/cli exec vitest --run test/gateway-core.test.ts test/gateway-local-service.test.ts --coverage.enabled=false`
- Passed: `pnpm --dir packages/assistantd exec vitest --run test/assistant-core-boundary.test.ts test/http.test.ts --coverage.enabled=false`
- Passed: direct `tsx` scenario that created a temp vault, ingested one Telegram capture, and observed one derived gateway conversation with `title: "Scenario thread"`, `canSend: true`, and `channel: "telegram"`.
- Failed outside this landing: `pnpm typecheck`
  - Existing failure in `packages/cli/test/cli-expansion-inbox-attachments.test.ts` complaining that an `attachments` property is not allowed on the current helper input type.
- Failed outside this landing: `pnpm test`
  - Existing failures reached in `packages/cli/test/inbox-cli.test.ts` for parser queue control/requeue coverage.
- `pnpm test:coverage` was already noisy on the same inbox-cli lane during repo-wide runs; no gateway- or assistantd-scoped failure surfaced before that unrelated break.

## Outcome

- Landed the step-2 local projection, opaque ids, and read-only assistantd routes while keeping `murph/gateway-core` contract-only and moving the local implementation to `murph/gateway-core-local`.
- Required spawned simplify/task-finish-review audit passes could not be executed because the current environment does not expose the subagent tool required by repo policy.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
