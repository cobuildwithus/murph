# PR66 Final Hard-Cut Cleanup

Status: completed
Created: 2026-06-08
Updated: 2026-06-08

## Goal

- Finish the PR66 hard-cut cleanup so runtime/job parser inputs reject legacy `source`, Web no longer exports dead first-pending-system demand helpers, deploy notes mention legacy Durable Object state, and PR verification reflects final checks.

## Success criteria

- `parseHostedWorkspaceInvocationRequest` rejects `source`.
- `parseHostedAssistantWorkspaceRuntimeJobInput` rejects request `source`.
- Unused first-pending-system mailbox helpers are deleted.
- Deploy notes mention existing `runner_bundle_slots` Durable Object state handling.
- PR body verification section records final local verification.

## Scope

- In scope: hosted-execution parser/test, assistant-runtime parser/test, hosted mailbox store deletion, hard-cut deploy/protocol notes, PR body verification.
- Out of scope: new runtime behavior, system-lane active wake support, or compatibility with old Temporal histories.

## Constraints

- Technical constraints: keep explicit hard-cut compatibility docs and guard tests that intentionally mention deleted demand surfaces.
- Product/process constraints: same PR branch follow-up; no unrelated refactors.

## Risks and mitigations

1. Risk: deleting parser tolerance breaks any stale caller still sending `source`.
   Mitigation: this is an intentional coordinated hard cut; tests assert rejection.
2. Risk: full verification is expensive.
   Mitigation: run focused parser tests first, then required full checks before push.

## Tasks

1. Remove parser `source` tolerance and dead validator helper.
2. Delete dead first-pending-system mailbox helpers.
3. Add/update parser tests for source rejection.
4. Update hard-cut deploy notes and PR body verification.
5. Run focused and full verification.

## Decisions

- Treat `source` as a removed runtime/job request field, not tolerated legacy input.
- Do not add a system-lane active-wake path.

## Verification

- `pnpm --dir packages/hosted-execution test -- hosted-runtime-control.test.ts` passed.
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-entrypoint.test.ts` passed.
- `pnpm hosted-temporal:guard` passed.
- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm docs:drift` passed.
- `pnpm test` passed.
- `pnpm verify:acceptance` passed after isolating and rerunning a transient CLI release-audit packaging failure.
Completed: 2026-06-08
