# Require discovered PostgreSQL integration proof

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Make required Host Support prove real PostgreSQL behavior on each code candidate, including suites currently disabled by opt-in flags or excluded by the ordinary Web workspace.

## Success criteria

- Discover existing PostgreSQL flag-bearing tests and database-only files without a maintained suite list.
- Apply checked-in Prisma migrations to an isolated loopback test database before execution.
- Run four bounded CI shards with serial files and reject missing, empty, skipped, failed, or duplicate execution receipts.
- Require database success in the existing release aggregator; documentation-only proof requires its database jobs to stay skipped.
- Prove discovery, shard partitioning, receipt rejection, the workflow gate, and the complete discovered real database inventory.

## Scope and owners

The existing Web Vitest configuration owns aliases and test setup. A small repo script owns database inventory, deterministic partitioning, enabling local flags, and receipt validation. Host Support retains required-check authority. Consent and supplement search keep their already-required dedicated database lanes. No production schema, product behavior, provider calls, secrets, or private CI changes are authorized in this branch.

## Evidence and design

The ordinary Web workspace excludes database-only files, and most real database suites skip without explicit flags. A mixed Vitest positional list can succeed despite a stale or excluded path, as recorded in the existing hosted-Web test-runner Frog entry. Derive inventory from current source rather than add another explicit list. Use the existing broad Web config so database-only tests are eligible. Database state remains ephemeral test state; no durable product owner changes.

## Failure and isolation

Reject remote or non-test database URLs before launching tests. Each CI shard has its own PostgreSQL service and runs files sequentially to preserve shared-schema tests. Missing migrations, database errors, collection errors, zero executed cases, or skips fail the required job. Keep provider boundaries synthetic and preserve real storage owners. Real database failures are investigated; schema or product behavior is never weakened to obtain green tests.

## Tasks

1. Implement and test inventory, shard selection, local activation, and execution receipt validation.
2. Add migrated PostgreSQL shards and include them in both aggregator proof modes.
3. Investigate dormant fixtures against current production contracts, then run focused mechanism tests, the complete discovered database inventory, typecheck, and complexity review; inspect privacy and full diff.
4. Update the testing owner, close this plan, commit and push, then open a draft PR for the original completion owner.

## Verification

The required gate is implemented. All four migrated shards pass: 22 files / 141 cases, 22 / 147, 21 / 124, and 21 / 230, totaling 86 files and 642 cases with no skips. Each database was prepared with all 219 checked-in migrations. Local proof used PostgreSQL 18.1; exact-head Ubuntu CI owns the configured PostgreSQL 17 proof. Node runner and workflow policy proof passes 31 cases, including actual Vitest success, skipped cases, and mixed existing/missing-file invocation. The Web and JavaScript typechecks, focused changed-test ESLint, workflow lint, complexity ratchet (zero debt; maximum changed function complexity 12), and documentation checks pass.

Dormant fixtures required current supported keyrings and KMS resource names, isolated test database names, registry-derived provider counts, current source-authority fields and clinical connection schema, and one accepted webhook revision advance. These fixes preserve production writers and add rejected-admission rollback proof. The large runtime-progress fixture passes without changes. Companion enrollment now runs the actual signup welcome eligibility and database reads; its mock sits at the email provider send boundary, with no-send and persisted attempt-state assertions retained.

Commands: `node --test scripts/run-postgres-tests.test.mjs scripts/pull-request-ci-policy.test.mjs`; `node scripts/run-postgres-tests.mjs --shard <1..4>/4` with separate migrated loopback test URLs; `pnpm --dir apps/web typecheck` and final `typecheck:prepared`; the repository TypeScript runner with JavaScript checking for both new scripts; changed-test ESLint; `actionlint .github/workflows/host-support.yml`; `pnpm complexity:diff`; `pnpm docs:drift`; `pnpm docs:gardening`; `git diff --check`.

Required GitHub Actions and ReviewGPT remain owned by the parent session after draft PR handoff. Existing provider fakes remain explicit limitations of these database tests.

## Changelog

No public changelog: this is internal CI verification and does not change member behavior.
Completed: 2026-09-10
