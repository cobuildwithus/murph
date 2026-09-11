# Prepare read-only Preview database isolation proof

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal and invariant

Prepare a reviewed, bounded way to establish whether Preview's runtime and
migration database connections are separate from the primary production database.
Credentials stay in their existing environments; no customer rows, account
mutations, application routes, or production deployment overrides are involved.

## Owner and evidence

The existing Web operational scripts own database probes. Separately scoped
Sensitive environment records have no connection-target identity metadata, so
listing configuration cannot establish isolation. The existing read-only
production helper can produce a fresh salted database fingerprint without
returning a hostname, connection string, database name, or cluster identifier.

## Design

Use one standalone Web script in an explicitly selected Vercel Preview build.
Read one PostgreSQL identity row per configured endpoint, sequentially, with
verified TLS, read-only startup settings and short connection/query deadlines.
Require both Preview identities to agree and differ from the fresh production
reference. Return only `different database` or `unable to verify`.

Matching identities are inconclusive because physical clones can retain a
cluster system identifier. Do not claim `same database` from this evidence.
This does not establish sanitized data, independent provider credentials, or
complete environment readiness. No new persistent state owner is introduced.
Remove the temporary diagnostic deployment after its operational use; retire
the script when environment provisioning supplies authoritative isolation proof.

## Tasks and completion criteria

1. Prepare the script, synthetic boundary tests and operator instructions.
2. Exercise the actual query against local PostgreSQL; test comparison, expiry,
   endpoint skew, unsafe URL options and closed error output; typecheck/lint.
3. Inspect privacy and the complete diff, commit a scoped candidate, and obtain
   the required external review and exact-head CI before hosted execution.
4. Record the actual hosted result separately from code readiness. Keep login
   activation and test-account creation held until their own prerequisites pass.

## Verification

- 29 focused Web Vitest cases, full Web typecheck and focused ESLint pass.
- Read-only PostgreSQL query proof and CLI output proof with synthetic data.
- Parent review, complexity check, documentation checks, ReviewGPT and CI.
- Hosted execution remains pending; preparing code is not database-isolation proof.

## Preparation outcome

The dormant probe, synthetic boundary tests and operator instructions are
prepared. Actual local PostgreSQL proof confirms the exported identity query,
independent digest agreement and read-only write rejection. The rebuilt bundle
passes its coarse-output, artifact-allowlist and local-identifier checks.

ReviewGPT round 1 accepted one routing-override finding against
`cc1357bf1aed9a2c0aadd78ee20b8c7254126c2e`. The correction rejects unsupported
URL query keys before connecting and requires complete credentials. A direct
pinned-driver regression reproduces the underlying override and confirms
rejection. Round 2 passed at `4301b861857a0d621b0e4a2a9a11ab8543323df4`
with no unresolved findings. Exact committed-turn, response hash and model
metadata were verified. Complexity and documentation drift checks pass.

This plan closes diagnostic preparation only. Required CI on the final
plan-closure commit and the subsequent authorized hosted execution are tracked
in PR #3285. No hosted connection, test account, login activation or production
alias change has run as part of this preparation. A separate actual hosted
result is required before claiming database separation.
Completed: 2026-09-11
