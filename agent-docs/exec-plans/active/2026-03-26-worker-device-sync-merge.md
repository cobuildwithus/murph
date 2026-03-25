# Worker Device-Sync Merge

## Goal

Merge the completed worker fixes for hosted device-sync and webhook hygiene into the current branch without overwriting unrelated in-flight edits already present in the main worktree.

## Scope

- Pull in the worker slices for:
  - source-bundle artifact hygiene
  - WHOOP webhook replay/idempotency hardening
  - hosted local-heartbeat hardening
  - hosted browser-auth replay defense
  - OAuth callback redirect sanitization
- Preserve existing unrelated changes, especially the current `apps/web/app/api/device-sync/agent/session/**` work and the unrelated CLI/core/query edits already in the branch.
- Run the required repo verification and the completion-workflow audit passes if the merged slice still touches production code/tests.

## Constraints

- Do not revert or delete unrelated existing worktree edits.
- Prefer merging worker patches surgically over replacing whole files when a shared file already differs in the main tree.
- Commit only files touched for this worker integration turn.

## Merge Order

1. Source-bundle hygiene guard and docs.
2. Device-sync daemon fixes with minimal overlap (`whoop`, `public-ingress`, redirect sanitization).
3. Hosted control-plane hardening (`local-heartbeat`, browser assertion replay defense).
4. Shared docs/inventory reconciliation.
5. Verification, completion-workflow audits, and commit.

## Verification Plan

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow passes: `simplify` -> `test-coverage-audit` -> `task-finish-review`

## Status

Completed in the current branch.

## Verification Notes

- `bash scripts/check-agent-docs-drift.sh` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm test:coverage` reached the final coverage gate, then failed on an unrelated pre-existing threshold miss in `packages/core/src/vault.ts` branch coverage (reported `77.04%` vs the global `80%` requirement). This merge did not touch `packages/core/src/vault.ts`.
- Completion workflow review passes were run against the merged device-sync diff (`simplify` -> `test-coverage-audit` -> `task-finish-review`); no additional blocker was identified beyond the unrelated coverage threshold failure above.
