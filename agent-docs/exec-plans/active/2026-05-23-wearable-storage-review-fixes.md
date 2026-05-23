# Wearable Storage Review Fixes

Status: active
Created: 2026-05-23
Updated: 2026-05-23

## Goal

Land focused follow-up fixes from local subagent and ReviewGPT review of commit
`0aaf76e0c088`, preserving the provider-agnostic wearable storage repair
architecture while tightening destructive-operation proof and operator
semantics.

Success means:

- Raw tombstone repair proves required receipt/provider-evidence files exist
  and match manifest SHA/size before mutation.
- Same-path tombstoning fails closed on cross-manifest role disagreement.
- Bounded repair passes cannot return an infinite no-progress `hasMore` loop
  for an oversized candidate.
- CLI/usecase dry-run semantics remain clear for selected versus report-only
  work, and recent-dense-raw flags cannot silently no-op.
- Focused tests, typecheck, privacy checks, ReviewGPT follow-up, and scoped
  commit workflow complete.

## Constraints

- Preserve the small architecture: core-owned proof/mutation, thin
  usecase/CLI wrappers, no generic raw delete API, no hosted cleanup scheduler,
  no query/browser rewrite.
- Do not expose local paths, provider payloads, sample values, secrets, account
  ids, or direct personal identifiers in outputs or committed artifacts.
- Review-only subagents and ReviewGPT may identify issues, but local Codex owns
  integration and verification.

## Working Set

- `packages/core/src/wearable-storage-migration.ts`
- `packages/core/test/wearable-storage-migration.test.ts`
- `packages/vault-usecases/src/usecases/integrated-services.ts`
- `packages/vault-usecases/src/usecases/types.ts`
- `packages/vault-usecases/test/runtime.test.ts`
- `packages/cli/src/commands/vault.ts`
- `packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Plan

1. Apply the smallest code/test fixes for confirmed review findings.
2. Collect remaining subagent and ReviewGPT findings.
3. Run focused tests, root typecheck or truthful scoped checks, diff/privacy
   checks, and direct CLI proof as needed.
4. Close the plan with `scripts/finish-task`.
