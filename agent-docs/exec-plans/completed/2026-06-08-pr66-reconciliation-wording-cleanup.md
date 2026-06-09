# PR66 Reconciliation Wording Cleanup

Status: completed
Created: 2026-06-08
Updated: 2026-06-08

## Goal

- Remove stale hosted-runtime demand wording from live docs and touched tests so PR66 consistently describes reconciliation facts and mailbox facts.

## Success criteria

- Live hosted-runtime docs no longer imply `/demand` or the old demand decision tree is active outside explicit compatibility or guard-test notes.
- Status and test wording avoids demand-shaped scheduler language.
- Active foreground wake docs keep system-lane work on normal invocation/reconciliation unless measured need proves otherwise.

## Scope

- In scope: PR66 docs/readme wording, docs index descriptions, and test names/error messages for the touched hosted runtime surfaces.
- Out of scope: runtime behavior changes, system-lane active-wake import changes, or deletion of legacy compatibility guard coverage.

## Constraints

- Technical constraints: preserve hard-cut compatibility notes and guard tests that intentionally name removed demand surfaces.
- Product/process constraints: keep the PR as a cleanup follow-up on the existing branch.

## Risks and mitigations

1. Risk: removing intentional historical demand references weakens migration/operator guidance.
   Mitigation: keep explicit hard-cut compatibility notes and guard-test labels.

## Tasks

1. Scan live docs/tests for stale hosted-runtime demand references.
2. Update stale wording toward mailbox facts and reconciliation facts.
3. Verify no `/demand` or old status-field names remain in active surfaces outside compatibility/guard contexts.
4. Run focused tests, docs drift, diff checks, and repo typecheck.

## Decisions

- Keep system-lane active wake out of this PR; document that system work uses normal invocation and reconciliation until measured need proves otherwise.

## Verification

- Commands to run:
  - `pnpm --dir packages/hosted-orchestrator-temporal test -- hosted-user-runtime-workflow.test.ts`
  - `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
  - `pnpm docs:drift`
  - `git diff --check`
  - `pnpm typecheck`
- Expected outcomes: all pass.
Completed: 2026-06-08
