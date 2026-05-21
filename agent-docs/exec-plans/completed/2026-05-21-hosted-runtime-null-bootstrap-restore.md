# Hosted runtime null-bootstrap restore hardening

Status: completed
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Close the final hosted-runtime ownership audit gap: a new hosted lease must
  cold-clear local runtime roots even when web has no durable workspace snapshot
  yet.

## Success criteria

- `restoreHostedWorkspaceRuntimeJobWorkspace({ workspace: null })` clears stale
  local vault/operator-home/runtime state and reports a cold null-bootstrap
  restore.
- Focused restore/workflow tests and scoped hosted verification pass.

## Scope

- In scope:
- `packages/assistant-runtime` null-bootstrap restore behavior and tests.
- Minimal docs/plan bookkeeping required by repo workflow.
- Out of scope:
- Reintroducing mailbox/Codex mini-checkpoints.
- Changing the Cloudflare active-owner/watchdog architecture.
- Broad Temporal command-order changes requiring replay migration.

## Constraints

- Technical constraints:
- Keep `idle_shutdown` as the only live durable workspace snapshot producer.
- Do not trust dirty local/warm state across hosted leases.
- Keep Temporal workflow state pointer-only.
- Avoid adding new scheduling or checkpoint abstractions.
- Product/process constraints:
- Preserve unrelated active ledger rows and dirty work.
- Run repo-required focused verification and completion audits.

## Risks and mitigations

1. Risk: Clearing bootstrap roots could remove state needed for first-run setup.
   Mitigation: Preserve root directory recreation and cover the branch with a
   focused regression test.

## Tasks

1. Patch null-bootstrap restore to cold-clear roots/caches and re-read artifact
   state afterward.
2. Add focused null-bootstrap regression coverage.
3. Run scoped verification, typecheck, and required closeout checks.

## Decisions

- Treat null-bootstrap as cold restore. Durable absence of workspace state means
  local roots are not authority.

## Verification

- Commands to run:
- `pnpm typecheck`
- focused assistant-runtime and hosted-orchestrator-temporal tests
- scoped `bash scripts/workspace-verify.sh test:diff ...`
- Expected outcomes:
- All pass, or any failure is proven unrelated and paired with focused passing
  proof for this scope.
Completed: 2026-05-21
