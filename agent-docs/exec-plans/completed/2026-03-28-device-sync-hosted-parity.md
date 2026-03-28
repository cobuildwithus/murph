# 2026-03-28 Hosted Device-Sync Parity

## Goal

Merge the reviewed hosted device-sync parity patch set into the current branch so hosted `device-sync.wake` execution can hydrate from hosted Postgres state, run a real one-shot `device-syncd` pass, and reconcile state back safely.

## Scope

Primary files:

- `packages/hosted-execution/src/{contracts.ts,builders.ts,parsers.ts}`
- `apps/web/src/lib/device-sync/{hosted-dispatch.ts,wake-service.ts,internal-runtime.ts}`
- `apps/web/src/lib/hosted-execution/hydration.ts`
- `apps/web/app/api/internal/device-sync/runtime/{snapshot,apply}/route.ts`
- `packages/assistant-runtime/src/{hosted-device-sync-control-plane.ts,hosted-device-sync-runtime.ts,hosted-runtime.ts}`
- `apps/cloudflare/src/runner-env.ts`
- targeted docs/tests under `apps/web/**`, `docs/device-sync-hosted-control-plane.md`, and `ARCHITECTURE.md` if the merged behavior changes the durable architecture story

## Desired Behavior

- Hosted execution contract carries richer `device-sync.wake` context, including sparse hint payloads.
- Hosted hydration preserves `connectionId`, `provider`, and signal payload JSON.
- `apps/web` exposes internal auth-gated snapshot/apply routes for hosted device-sync runtime state.
- Cloudflare-hosted runner hydrates device state from hosted Postgres into the one-shot runtime before the sync pass.
- Post-pass reconciliation writes back hosted status/timestamp/error/token changes without null-clobbering.
- Token bundle writes are fenced on the observed hosted token version.
- Hosted webhook hint sanitation stays sparse and strips refresh-token-shaped fields.

## Constraints

- Do not overwrite or revert unrelated in-flight edits already present in this worktree.
- Preserve the existing hosted bundle/user-env split and adjacent hosted-runtime seam work.
- Keep the current local-agent-vs-hosted ownership decision out of scope.
- Keep the larger committed side-effect-journal redesign out of scope.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- focused hosted device-sync tests as needed while iterating

## Status

Completed on 2026-03-28.

Focused verification passed:

- `pnpm --dir apps/web typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir ../.. exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-contract-parity.test.ts apps/web/test/hosted-execution-hydration.test.ts apps/web/test/device-sync-hosted-wake-dispatch.test.ts apps/web/test/device-sync-internal-runtime.test.ts --no-coverage --maxWorkers 1`
- direct `pnpm exec tsx` assertion covering hosted assistant-runtime activation bootstrap plus empty-vault maintenance no-op behavior

Repo-wide required verification was attempted and blocked by unrelated existing CLI issues outside this lane:

- `pnpm typecheck`: `packages/cli/src/assistant/automation/reply.ts` `TS2353` for existing `advanceCursor` properties
- `pnpm test`: `packages/cli` build failed with `ENOTEMPTY` while removing `packages/cli/dist/assistant`
- `pnpm test:coverage`: same existing `packages/cli/src/assistant/automation/reply.ts` `TS2353`
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
