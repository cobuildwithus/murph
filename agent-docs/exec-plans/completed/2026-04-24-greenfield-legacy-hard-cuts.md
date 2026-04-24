# Greenfield legacy hard-cut cleanup

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Remove seven explicitly scoped legacy compatibility paths now considered unnecessary under greenfield assumptions, while keeping current storage schemas, current encryption/keyring behavior, and current retry/recovery contracts intact.

## Success criteria

- Hosted user root-key envelopes read and write only the current object key derived from the current envelope key.
- Pending runner cleanup recovery reads only the current run-id array and per-run sidecars.
- Hosted member Telegram routing private state accepts only the current JSON envelope shape.
- Pending assistant usage/runtime-issue readers require current versioned JSON envelopes while preserving missing-directory and skip-invalid behavior.
- Hosted web Prisma baseline migration directly matches the current schema; the follow-up hardening migration is removed.
- Deprecated hosted-ingress trigger aliases and deprecated preferences schema alias are removed.
- Focused tests, typecheck, required audit passes, and privacy/diff checks are run or blocked reasons are documented.

## Scope

- In scope:
  - `apps/cloudflare/src/user-key-store.ts` and directly coupled tests.
  - `apps/cloudflare/src/user-runner/runner-state-store.ts` and directly coupled tests.
  - `apps/web/src/lib/hosted-onboarding/member-private-codecs.ts` and codec tests.
  - `packages/runtime-state/src/{assistant-usage,assistant-runtime-issues}.ts` and tests.
  - `apps/web/prisma/{schema.prisma,migrations/**}` plus migration assertions.
  - `apps/web/src/lib/hosted-ingress/control.ts`.
  - `packages/contracts/src/preferences.ts` and public-entrypoint tests.
- Out of scope:
  - Hosted-execution parser alias rejection, active retry/recovery fallbacks, setup shims, and memory document legacy parsing.
  - Recipient/keyring reconciliation and current managed-recipient rotation safety.
  - Any broader hosted web protocol, billing, runner, or assistant-runtime reliability changes.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty work in this checkout.
  - Treat `apps/cloudflare/src/user-runner/runner-state-store.ts` as overlapping active work and edit only the scalar pointer fallback.
  - Do not add dependencies.
- Product/process constraints:
  - Follow high-risk repo workflow: plan, ledger, focused proof, audits, and scoped commit if safe.
  - Do not expose local personal identifiers in generated files, logs, docs, or commit text.

## Risks and mitigations

1. Risk: Removing too much crypto reconciliation could break current hosted key rotation.
   Mitigation: Remove only legacy object-key recovery, not current envelope decryption by stored key id or managed-recipient reconciliation.
2. Risk: Removing pending-cleanup fallback could regress current multi-run cleanup recovery.
   Mitigation: Keep run-id array and per-run sidecar recovery unchanged and test multi-id behavior.
3. Risk: Prisma baseline squash could omit a column/index from the initial migration.
   Mitigation: Assert baseline SQL contains the current column and unique index, and delete only the follow-up migration.

## Tasks

1. Done: Register plan and split worker ownership.
2. Done: Remove the legacy compatibility paths and update tests.
3. Done: Run focused package/app checks and direct proof.
4. Done: Run required completion audit passes and fix actionable findings.
5. Done: Close the plan. Scoped commit is blocked by overlapping dirty work in shared files.

## Decisions

- Treat the user-provided greenfield assumption as explicit approval to hard-cut the named old-state rescue paths.
- Keep current schema/versioned envelopes and current runner cleanup arrays as the only supported persisted shapes.

## Verification

- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/user-key-store.test.ts apps/cloudflare/test/runner-state-store.bundle-slots.test.ts --no-coverage` (22 tests).
- Passed: `pnpm exec vitest run apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/hosted-execution-handoff.test.ts --config apps/web/vitest.workspace.ts --no-coverage` (8 tests).
- Passed: `pnpm exec vitest run apps/web/test/hosted-onboarding-member-store.test.ts --config apps/web/vitest.config.ts --no-coverage -t "persisted Telegram private payload|persisted Telegram thread target"` (5 passed, 30 skipped).
- Passed: `pnpm --dir packages/runtime-state exec vitest run --config vitest.config.ts --no-coverage test/assistant-usage.test.ts test/assistant-runtime-issues.test.ts` (18 tests).
- Passed: `pnpm --dir packages/contracts exec vitest run --config vitest.config.ts test/public-entrypoints.test.ts` (3 tests).
- Passed: `pnpm --dir packages/runtime-state test:coverage` (117 tests).
- Passed: `pnpm --dir packages/contracts test:coverage` (80 tests plus schema artifact verification).
- Passed during this task before unrelated core dirty-tree changes appeared: `pnpm typecheck`.
- Passed: `pnpm test:smoke`.
- Passed: `git diff --check` on the touched task files.
- Passed: scoped task diff privacy scan for local identifiers/secrets.
- Blocked after unrelated active core changes appeared: `pnpm typecheck`, `pnpm --dir apps/cloudflare typecheck`, and diff-aware verification now fail at `packages/core/src/vault-sync.ts(33,8)` because `./vault-sync/merge.ts` is missing in the current dirty tree. Active rows outside this task own `packages/core/src/vault-sync.ts` and `packages/core/src/vault-sync/**`.

## Audits

- `simplify` audit: no findings. It noted a proof gap around current-object-key keyring decryption.
- `coverage-write` audit: added focused Cloudflare test proof for root-key envelope keyring decryption after platform key rotation and scalar current recovery-index rejection.
- `task-finish-review` audit: no findings.

## Commit state

- Scoped commit was not created because multiple touched paths have overlapping unrelated dirty edits from other active rows, including `apps/cloudflare/src/user-runner/runner-state-store.ts`, `apps/web/test/hosted-onboarding-member-store.test.ts`, and the shared coordination ledger. Committing whole files would absorb work outside this task.
Completed: 2026-04-24
