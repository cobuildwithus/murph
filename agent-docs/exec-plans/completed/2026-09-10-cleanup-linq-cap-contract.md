# Prepare the held Linq active-member cap column drop

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Prepare a separate held draft PR that removes the retired physical Linq cap
column after the cap-free application release is deployed and old executors
have drained. Preserve weighted routing and proactive conversation quotas.

## Success criteria

- One idempotent postdeploy contract migration drops only the retired column.
- Existing owner docs identify the pre-merge gates for automatic execution.
- The exact SQL applies and replays on an isolated migrated local database;
  current Prisma-backed inventory and routing proofs pass after the drop.
- The completed implementation is a held draft stacked on code-release PR #3182.

## Scope and constraints

SQL and deployment owner docs only. No application-code or generated-client
change beyond #3182, no new runtime gate, and no production mutation. Do not
merge while the deployment, old CLI, applicable pinned-Workflow, or rollback
admission requirements remain unproven. Private operational evidence stays out
of repository artifacts.

## Risks and mitigations

Old generated Prisma clients can implicitly select this column during whole-row
upserts. Removing it before their final invocation is unsafe. The automatic
contract lane proves production alias provenance and HTTP lifetime only; the
operator must establish CLI and applicable durable-execution drain separately
before this migration reaches main. Recovery after the drop uses compatible
code, or separately reviewed schema re-expansion before older code is restored.
The existing migration runner owns transaction-local short lock/statement
timeouts and migration serialization.

## Tasks

1. Done: add the narrow idempotent contract SQL and update owner docs.
2. Done: apply and replay the exact SQL on the isolated local test database, then
   pass current inventory and routing PostgreSQL proof from the prepared release.
3. Done: check source identity, whitespace, privacy, and complexity applicability.
4. Close this preparation plan, commit, and open the separate held draft PR.

## Decisions

- Keep the PR held until all pre-merge gates have evidence; draft status alone
  does not enforce any database drain.
- Reuse the prepared code-release client for local proof because this branch
  changes no application source or generated schema.
- Root session owns candidate review, Ready, required external review, and CI.

## Verification

- Exact contract SQL applied twice successfully in one bounded transaction on
  an isolated loopback test database initialized with normal migrations; the
  legacy column is absent afterward.
- Post-drop inventory and home-routing PostgreSQL suites passed: 2 files,
  32 tests, one Vitest worker, using the prepared code-release client.
- Application source, generated Prisma schema, and package manifests are
  identical to #3182, whose Web typecheck and focused lint passed. No additional
  typecheck is applicable to the SQL/docs-only delta.
- Whitespace and privacy readback passed.
- `pnpm complexity:diff --base codex/cleanup-linq-cap` passed with no authored
  JavaScript/TypeScript source changes to analyze.

## Outcome

The SQL and evidence are ready for a separate held draft PR. Production admission
remains blocked on the explicit owner gates, not on further code preparation.
The root session owns the PR review and any future Ready admission.
Completed: 2026-09-10
