# Production schema presence gate

Status: completed
Created: 2026-11-01
Updated: 2026-11-01

## Outcome and ownership

Fail the existing Prisma migration runner after successful migration deployment
when the checked-in schema requires missing database objects. Prisma migration
history alone cannot prove presence because applied migrations are skipped.
Reuse the migration URL/owner guards and their test injection pattern.

## Design

Parse the checked-in schema through Prisma DMMF, preserving database mappings.
Use bounded catalog-only reads for enum/value and model/table/column presence.
Ignore defaults, indexes, constraints, precision, and extra database objects.
No new workflow, environment switch, bypass, runtime state, or production write.
The schema parser is pinned to the installed Prisma version; generated runtime
DMMF is insufficient because it omits field database mappings.

## Tasks and proof

1. Add the presence comparison and invoke it after migrate deploy succeeds.
2. Cover matching/missing/mapped/cosmetic cases and runner failure ordering.
3. Prove current migrations pass on isolated local Postgres and the historical
   missing enum value fails; compare main schema to production read-only.
4. Run Web typecheck, production migration guard tests, complexity and diff
   review; close this plan and commit without push or PR.

## Boundaries and risks

The gate runs only at migration time, never on a reply path. A failure stops
build promotion but cannot undo migrations already applied. Existing expand-only
and schema-owner checks remain in place. Production validation uses only the
approved opaque read-only SQL helper and emits aggregate comparison results.
Internal deploy tooling only: no member-facing changelog or UI proof applies.
External PR review and CI remain outside this local-only task.

## Verification

All required local proof completed. Candidate diff reviewed for mappings,
query bounds, failure ordering, privacy, and preservation of the existing owner
and expand-only guards. No migration files changed and no production writes ran.

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/production-migration-guard.test.ts --no-coverage`: exit 0, 80 tests.
- `pnpm --dir apps/web typecheck`: exit 0, including generated Prisma client.
- `pnpm --dir apps/web exec oxlint scripts/hosted-web-schema-contract.ts scripts/run-prisma-migrate-deploy.ts test/production-migration-guard.test.ts`: exit 0; two pre-existing unused-symbol warnings.
- `pnpm complexity:diff`: exit 0; no hotspots, new module maximum complexity 9.
- `git diff --check`: exit 0.
- Isolated local Postgres: create database, then run
  `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_dev_schema_contract_gate pnpm --dir apps/web prisma:migrate:deploy`:
  exit 0 after all 265 migrations; schema contract passed.
- Rename the local enum label `linq` to `linq_removed_for_proof`, then repeat the
  same migration command: exit 1 despite no pending migrations, with exactly
  `enum value "HostedPhoneCallResultNotificationChannel"."linq"` missing.
  Restore the label and repeat: exit 0. No migration ledger edits were needed.
- Read-only production: invoke the same catalog assertion via the approved SQL
  helper, using schema from origin/main at
  `cbfad5f52b39a7086ff6aabac4075b00ca8a1b50`: exit 0, exact output
  `Hosted web schema contract passed: nothing missing.`
  Only expected catalog names were read; results stayed in process memory.

The temporary read-only adapter initially failed locally on ESM/CJS named-import
interop before any database call (exit 1); a `.cts` scratch entrypoint corrected
that invocation. Root-level `pnpm exec oxlint` was unavailable; the
app-owned command above passed. Neither required a repository workaround.

No push, PR, CI, ReviewGPT, deployment, repair, new workflow, flag, or bypass.
Checks intentionally exclude types, constraints, defaults, precision, and extra
objects. Existing public-schema ownership remains unchanged.

Dependency review uses the narrow `@prisma/get-dmmf` parser rather than the
full Prisma internals toolkit, avoiding unnecessary CLI/config dependencies.

- `pnpm deps:guard`: exit 0.
- `pnpm deps:audit`: exit 1, three high advisories in existing `deepmerge-ts`,
  `zod`, and `follow-redirects` dependency paths. Those versions already exist
  in the base lockfile; no new high advisory remains in the parser dependency
  path. Dependency upgrades outside this gate are deliberately deferred.
- `pnpm deps:ignored-builds`: exit 0, but pnpm reports it cannot identify builds
  from this installation layout. The new parser dependency closure has no
  install lifecycle scripts, and no build-policy exception was added.
Completed: 2026-11-01
