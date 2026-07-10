# PR 475 Receipt And Archive Review Fixes

## Goal

Close the proven PR #475 review gaps before merge: make hosted canonical-write receipt pointers crash-durable across foreground runner death, tighten integration-ingest ZIP archive entry validation to the documented single matching entry, and remove redundant receipt-log entry count state from workspace status.

## Constraints

- Keep the fix inside existing hosted workspace checkpoint and artifact-store ownership boundaries.
- Do not expose a general foreground workspace checkpoint capability to assistant code.
- Keep archive validation simple and exact; do not add new archive formats or sidecar rules.
- Preserve rollback/restore support for older workspaces that still contain receipt-log refs.
- Run focused tests, typecheck, and PR-lane verification before merge.

## Plan

1. Verify the interrupted Claude findings against current code and tests.
2. Add the smallest runner-owned receipt checkpoint path that records the new workspace version but keeps local runtime state dirty for idle snapshot.
3. Enforce exact ZIP entry names and update focused archive tests and docs if needed.
4. Delete redundant receipt-log entry-count status ownership while preserving restore-marker correctness.
5. Run focused verification, review the diff, close this plan with a scoped commit, then push the PR branch.

## Verification

- `pnpm --dir packages/core test integration-ingests.test.ts`
- `pnpm --dir packages/assistant-runtime test hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir packages/assistant-runtime test hosted-runtime-workspace-restore-codex-continuity.test.ts`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm typecheck`
- `pnpm test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/src/hosted-runtime/canonical-write-receipt-log.ts packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-restore-codex-continuity.test.ts packages/core/src/integration-ingests.ts packages/core/test/integration-ingests.test.ts`
- `git diff --check`

## State

Ready to close. Claude transcript reconstructed; review findings fixed and locally verified.
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
