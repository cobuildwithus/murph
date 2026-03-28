# Cloudflare Container Class Migration

Status: completed
Created: 2026-03-27
Updated: 2026-03-28
Completed: 2026-03-28

## Goal

Replace the hosted runner's low-level `ctx.container` lifecycle glue with the official `@cloudflare/containers` `Container` class while preserving the current one-job-at-a-time hosted execution semantics.

## Scope

- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/{index.ts,user-runner.ts,deploy-automation.ts}`
- `apps/cloudflare/{package.json,wrangler.jsonc,README.md,DEPLOY.md}`
- focused Cloudflare tests that prove runner invocation, destroy behavior, and generated Wrangler config

## Constraints

- Keep `HostedUserRunner` as the per-user queue/orchestration layer for this pass.
- Do not widen the hosted queue state machine or change persisted bundle/journal formats.
- Preserve the internal commit/finalize/outbox callback flow.
- Keep the migration proportional: introduce a companion `RunnerContainer extends Container` binding instead of rewriting the broader hosted execution architecture.

## Verification

- Focused: `pnpm --dir apps/cloudflare test`
- Required repo checks after landing: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Required completion-workflow audits: `simplify`, `test-coverage-audit`, `task-finish-review`

## Notes

- The container package's built-in alarms conflict with `HostedUserRunner`'s existing alarm/queue scheduling when both live in the same Durable Object. This pass avoids that conflict by splitting the queue DO and the container-backed DO into separate bindings.

## Outcome

- Switched the hosted runner container seam onto the companion `Container`-class binding shape without widening the queue/state machine.
- Kept the queue Durable Object separate from the container-backed execution surface so the existing alarm/orchestration behavior remains intact.
- Landed the related Cloudflare typing and runner-surface updates in the shared worktree cleanup batch.
