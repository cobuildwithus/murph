# Hard-cut hosted wake cleanup

Status: completed
Created: 2026-04-18
Updated: 2026-04-18

## Goal

- Land the remaining safe hard-cut cleanup from the returned hosted-wake patch so HostedWake/Cursor stays the single canonical hosted execution queue path.

## Success criteria

- Remove the remaining legacy hosted execution dispatch/outbox surfaces that the returned patch still requires cutting in the current tree.
- Keep Cloudflare and web control paths aligned on the wake-only contract and current control env naming.
- Update schema/tests/docs only where the hard-cut cleanup actually changes current behavior.

## Scope

- In scope:
- `apps/cloudflare/**`
- `apps/web/src/lib/hosted-execution/**`
- `apps/web/src/lib/hosted-wake/**`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/src/lib/hosted-share/**`
- `apps/web/app/api/internal/hosted-execution/**`
- `apps/web/prisma/**`
- `packages/cloudflare-hosted-control/**`
- `packages/hosted-execution/**`
- hosted execution docs/config touched by the supplied patch
- Out of scope:
- unrelated hosted onboarding/auth flows
- unrelated tooling/audit-bundle work already in flight

## Constraints

- Preserve unrelated in-flight edits, especially the existing tooling changes already present in the worktree.
- Treat the downloaded patch as intent, not overwrite authority; reconcile against current code where prior hosted-wake phases have already landed.
- Keep the cleanup hard-cut and behavior-focused; do not add new fallback architecture.

## Risks and mitigations

1. Risk: Removing legacy control surfaces can strand callers still using them.
   Mitigation: Verify current imports/routes before deletion and update docs/contracts in the same change.
2. Risk: Schema cleanup can break current wake scheduling paths.
   Mitigation: Run app/package verification on the touched hosted slices and keep migration scope limited to the removed outbox model.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare apps/web packages/cloudflare-hosted-control packages/hosted-execution`
- required completion-workflow audit passes for this repo task class

## Outcome

- Removed the remaining hosted execution outbox/manual-dispatch HTTP seams and converged the worker/web flow on hosted-wake scheduling.
- Updated Cloudflare and hosted-web tests to exercise the wake-only path, including direct Durable Object RPC where the HTTP surface was intentionally removed.
- Added the Prisma migration that drops the obsolete `ExecutionOutbox` table.

## Notes

- Repo-required verification is green.
- Required `coverage-write` / `task-finish-review` audit subagent passes remain blocked in this session because subagent spawning is restricted unless the user explicitly authorizes delegation.
Completed: 2026-04-18
