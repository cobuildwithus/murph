# Hosted runtime null-bootstrap restore hardening

Status: active
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
- Temporal accepted-processing waits do not consume volatile runtime-result
  wakes before durable completion evidence.
- Dead warm-restore hooks removed where they no longer represent a supported
  ownership path.
- Focused restore/workflow tests and scoped hosted verification pass.

## Scope

- In scope:
- `packages/assistant-runtime` null-bootstrap restore behavior and tests.
- `packages/hosted-orchestrator-temporal` accepted-processing wake flag behavior
  and tests.
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
2. Risk: Preserving runtime-result wake after accepted processing could create a
   short repeated demand loop.
   Mitigation: This only keeps an existing due pointer alive until durable
   completion evidence; owner-watchdog timing still bounds rechecks.

## Tasks

1. Patch null-bootstrap restore to cold-clear roots/caches and re-read artifact
   state afterward.
2. Remove dead warm-restore callbacks/hooks that no longer support the
   architecture.
3. Preserve runtime-result wake flags on accepted processing and add focused
   workflow coverage.
4. Run scoped verification, typecheck, and required closeout checks.

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
