# Fence retention rearming against stale checkpoints

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Make the one-time dormant-snapshot rearm a CAS-visible workspace mutation so
  an invocation that read the prior wake cannot checkpoint over it.

## Success criteria

- The phase-one migration advances `hosted_workspace.version` for every
  rearmed persisted snapshot.
- A stale checkpoint using the pre-migration version conflicts and cannot clear
  the due retention wake.
- Runner transport-failure recovery treats a newer workspace version as
  committed runtime progress only when `checkpointedAt` also changed from the
  invocation baseline.
- Migration-only version advancement cannot complete an accepted runtime
  attempt falsely.
- Real-Postgres interleaving proof, focused tests/typechecks, canonical
  verification, ReviewGPT, and PR CI pass.

## Scope

- In scope:
  - The existing content-retention migration and PostgreSQL proof.
  - Cloudflare accepted-runtime transport recovery and focused tests.
  - Current retention reliability/protocol/deploy documentation.
  - PR #936 round-six correction evidence.
- Out of scope:
  - A new marker, dispatcher, queue, checkpoint API field, or reconciliation
    owner.
  - Disabling hosted ingress or requiring an unproven deployment pause.

## Tasks

1. Trace workspace checkpoint CAS, ambiguous completion recovery, migration
   writes, and current deployment ordering.
2. Make the rearm increment the existing workspace CAS version.
3. Require changed checkpoint time alongside newer version for ambiguous
   runtime-commit recovery.
4. Add migration/checkpoint interleaving and migration-only progress
   regressions.
5. Align durable rollout guidance, verify, commit/push, and continue the final
   review loop.

## Decisions

- Accept ReviewGPT round six's race: an in-flight invocation can overwrite a
  raw wake update because the migration leaves the CAS version unchanged.
- Reject a raw version-only fix because the runner currently interprets any
  newer version as accepted runtime progress after transport ambiguity.
- Use the existing `version` plus `checkpointedAt` owners together: migration
  changes only the former; every real checkpoint changes both.

## Verification

- `pnpm --filter @murphai/cloudflare-runner typecheck`
- `pnpm --filter @murphai/hosted-web typecheck`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runtime-invocation-transport-failure.test.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/hosted-runner-container-identity.test.ts`
  - 3 files and 129 tests passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-mailbox-schema.test.ts`
- `DATABASE_URL=<LOCAL_REDACTED_DATABASE_URL> MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-mailbox-content-retention-migration-postgres.test.ts`
- Required product-experience re-review: `PASS`.
- Canonical `pnpm test:diff -- <changed runtime, migration, tests, and durable docs>`
  - Web: 514 files and 6,553 tests passed; 13 files and 174 tests skipped.
    Typecheck, zero-error lint, development smoke, and production build passed.
  - Cloudflare: 106 Node files and 1,899 tests passed; 2 Worker files and
    2 tests passed. Typecheck passed.
- `git diff --check` and the task privacy scan passed.
Completed: 2026-07-26
