# Replace consent persistence mocks with PostgreSQL proof

## Outcome and invariant

Prove the hosted consent audit ledger and current grant remain coherent across
concurrent decline retries, acceptance, withdrawal, and failed transactions.
No production behavior changes.

## Existing owner and scope

Reuse legal/consent.ts, health-data-consent-withdrawal.ts, createPrismaClient,
Vitest, and the existing hosted-Web CI PostgreSQL service. Replace fake persisted
state assertions while retaining registry, auth, provider cleanup, and runtime
barrier coverage. The new suite uses its own local test database with the current
Prisma schema; no copied table definitions or production data.

## Plan

- [x] Replace fake decline/withdrawal persistence tests with real database proof.
- [x] Wire the focused database suite into existing Web test shards and update verification owners.
- [x] Run focused PostgreSQL tests, retained unit tests, workflow policy tests, Web typecheck, and complexity review.
- [x] Present reviewed diff and exact proof to the parent before final commit/PR readiness.

## Failure and concurrency proof

Hold a real decline transaction before commit and observe another backend blocked
on the same event uniqueness constraint. Inject a failure after a real grant write
inside its real transaction and assert both event and grant rollback. Preserve
sequential withdrawal retry idempotency without inventing a concurrent-withdrawal
guarantee. Missing legacy consent stays distinct from explicit withdrawal.

## Product and changelog

Internal test infrastructure only; no member-visible behavior, prompt, hot reply
path, deployment, or changelog change.

## Evidence

- Frozen dependency installation, Prisma generation, and the existing device-syncd build prerequisite passed.
- Current-schema `prisma db push` created the isolated local test database in 28.9 seconds (23 seconds schema work).
- `MURPH_CONSENT_TEST_DB_URL="$LOCAL_POSTGRES_URL" pnpm --dir apps/web test:prepared test/legal-consent-postgres.test.ts test/legal-consent.test.ts test/hosted-health-data-consent-withdrawal.test.ts test/legal-consent-routes.test.ts`: 40 tests passed across four files.
- Final focused PostgreSQL rerun with `--reporter=verbose`: all six cases executed and passed, no skips.
- `pnpm --dir apps/web typecheck`: passed.
- Focused ESLint for the three changed Web tests: passed.
- `node --test scripts/pull-request-ci-policy.test.mjs`: 24 passed, including mutations removing the consent URL and schema preparation.
- `pnpm complexity:diff`: passed; the source-only metric excludes tests, and no production source changed. Manual review retained one small fixture helper and one transaction-boundary wrapper; queries remain real.
- Diff whitespace and direct-identifier scans passed. Existing Frog entries cover the fresh-checkout prerequisite; no new repository friction was introduced.
- Parent reviewed database and CI behavior; removed incidental event-ID formatting assertion and clarified verification-doc placement.

The original fake grant-state tests are replaced. Provider cleanup/runtime-control
failure handling, registry validation, route authentication, and origin checks
remain covered. Parent candidate review passed and authorized the final scoped commit and PR.
The parent owns pending exact-head CI monitoring. No production behavior, dependency, or schema change is authored.
Status: completed
Updated: 2026-09-05
Completed: 2026-09-05
