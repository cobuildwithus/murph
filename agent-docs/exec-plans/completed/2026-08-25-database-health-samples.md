# Make database health samples temporally and structurally truthful

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Make database-health history distinguish scheduled Cron time from actual collection time and fail incomplete primary-only metric families closed.

## Success criteria

- Primary-only metric families require an explicit primary role.
- Samples retain scheduled and actual collection time for direct Durable Object history reads.
- Alert copy distinguishes PlanetScale PgBouncer server-pool capacity from Web's local pool.
- Focused Cloudflare tests, exact-head ReviewGPT, and required PR checks resolve.

## Scope

- In scope: database-health Durable Object store/monitor/metric normalization, an additive collection-time field, alert wording, tests, and current owner docs.
- Out of scope: a public endpoint, raw metric/label exposure, a new storage owner, Web-local pool monitoring, and alert-provider changes.

## Constraints

- Technical constraints: keep schema changes rollback-compatible and history bounded; do not change alert or baseline ownership.
- Product/process constraints: Cloudflare reliability/trust-boundary PR with sensitive final ReviewGPT and an explicit deployment/rollback contract.

## Risks and mitigations

1. Risk: A missing role label could be a provider contract change rather than malformed telemetry.
   Mitigation: follow the documented primary-only family contract and route missing families through existing bounded incomplete-telemetry handling.
2. Risk: Additive schema deployment can overlap old Worker versions.
   Mitigation: make new fields nullable/additive, preserve legacy reads, and document the compatibility window.

## Tasks

1. Add tests for explicit-primary labels, actual check time, legacy nullable reads, and unambiguous alert wording.
2. Add the nullable collection timestamp and strict role selection without changing persistence ownership.
3. Keep history access on the existing direct Durable Object RPC; do not add a public route in this PR.
4. Run focused Cloudflare tests/typecheck and inspect retention and rollback behavior.
5. Commit, push, open the draft PR, launch both ReviewGPT stages in parallel with CI, resolve findings, close this plan, and push the final scoped commit.

## Decisions

- Keep the Durable Object as the only database-health state owner and keep provider labels or URLs out of history.

## Verification

- Commands to run: focused database-health metric/store/monitor/Durable Object tests, Cloudflare typecheck, and `git diff --check`.
- Expected outcomes: role-less primary-only series are incomplete, scheduled and collection time remain distinguishable, legacy rows remain readable, and no private provider material enters history output.
Completed: 2026-08-25
