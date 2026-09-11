# Resolve scheduler integration proof blockers

Status: active
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Establish trustworthy integration evidence for the scheduler churn protection and complete its authorized merge. The public runtime ownership fix is merged.

## Success criteria

- Identify each failing assertion at its actual runtime or test owner.
- Preserve bounded device progress, exactly one reminder delivery, scoped provider requests, and foreground completion proof.
- Pass affected integration scenarios and relevant typechecking on the candidate.
- Keep required CI green and merge only with supported compatibility evidence.

## Scope

- In scope: diagnostic improvements and proven corrections needed for integration proof; local test environment parity.
- Out of scope: unrelated runtime changes and production operations. The broader verification audit is reported separately.

## Constraints

Use synthetic evidence and closed diagnostic fields. Preserve unrelated work. Do not weaken assertions or add unscoped provider responses to hide unexplained retries.

## Risks and mitigations

- A test failure may expose a runtime defect. Trace the actual composed owners before choosing the fix.
- Local database defaults can differ from CI. Validate connection timezone explicitly without changing shared server settings.

## Tasks

1. Reproduce Junction requests and fairness yields with finite failure diagnostics.
2. Trace the foreground Environment completion failure.
3. Make the smallest proven correction and run focused integration proof plus typechecking.
4. Review, commit, obtain required CI, and finish the scheduler merge.

## Decisions

- Keep the Junction global request-count assertion while identifying any extra request owner.
- A fairness pass may yield before processing jobs; its shutdown barrier must not prevent the retry needed to establish progress.
- Initial local reproduction reached an earlier delivery failure with database-generated timestamps offset from UTC. Test the UTC connection hypothesis before changing behavior.

## Verification

- Scheduler full local verification passed after base reconciliation; exact-head Verify CI passed.
- Fresh integration CI failed Junction request count, fairness positive-progress wait, and foreground Environment completion.
- Cloudflare typecheck completed without diagnostics after adding failure-only fields.
- UTC local Junction and fairness reproduction is in progress.

## Broader verification audit (unfixed findings)

1. `scripts/workspace-verify.sh` returns from the repository-internal fast path before honoring `runVerifyCli`. The real diff classifier marks `scripts/build-test-runtime-prepared.mjs` for both; a composed route probe omitted CLI verification.
2. Root configuration and smoke fixture changes can select only generic guards locally. `package.json`, `tsconfig.json`, and `vitest.config.ts` are fast-path roots; smoke fixtures lack a behavior owner. Required broad CI limits this local gap, but the testing map overstates local coverage.
3. Local `verify:acceptance` omits `test:repo-tools`, which required host-support CI runs separately. A local acceptance result therefore does not cover the repository verification tools themselves.
4. `scripts/linq-production-canary-ci.test.mjs` and `scripts/review-gpt-pr-base-fetch.test.mjs` are outside the automatic Node/Vitest inventories. Direct execution works; entrypoint discovery does not include them.
5. Hosted-local process filters validate the number of declared patterns and trust Vitest exit status. An unmatched synthetic pattern exits successfully with all tests skipped. Current patterns match, but there is no guard proving the intended integration inventory is covered exactly once.
6. `apps/cloudflare/test/hosted-local-stale-deferred-replay-e2e.test.ts` is absent from the scenario registry. Its cold restore with a stale invocation is distinct from the registered case that warms the runtime first. Ordinary node tests exclude E2E files.
7. The Web PostgreSQL pool does not enforce the UTC session semantics assumed by the installed Prisma adapter. A read-only adapter probe under a non-UTC database default returned timestamps offset from UTC; the UTC session did not. This is a connection-owner precondition hidden by UTC CI databases. It does not by itself prove the cause of a particular delivery timeout.

These findings are review evidence, not claims of completed fixes. The first three have broader required CI coverage; the inventory omissions affect automatic coverage itself.
