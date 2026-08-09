# Database health telemetry incident remediation

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Keep genuine production database-pressure conditions fail-closed and recurring.
- Report PlanetScale telemetry loss as a monitoring outage, not as evidence that
  the database itself is degraded.
- Send one acknowledged operator page per uninterrupted telemetry outage while
  retaining paced exact-body retries for failed or ambiguous delivery.
- Preserve a bounded, allowlisted record of which required metric families were
  absent so the next provider-side outage is diagnosable without raw payloads.

## Evidence

- The production control database remained within its configured connection
  capacity and had no waiting or idle-in-transaction sessions during the live
  investigation.
- The supplied bounded sample export contained only
  `required_metrics_missing` failures, followed by successful samples without a
  database restart.
- The operator messages repeated every 30 to 35 minutes and used generic
  database-pressure openings even though the only condition was unavailable
  monitoring telemetry.
- Existing persisted samples and warnings identify the failure class but not
  the missing required metric family, so provider-specific root-cause proof is
  unavailable for the completed incident.

## Success criteria

- Two consecutive telemetry failures still open and page a monitoring incident.
- After both destinations acknowledge that page, continued telemetry failures
  do not admit recurrent pages until a successful sample closes the incident.
- A failed or ambiguous first page remains pending and retries under the existing
  30-minute provider-attempt fence with the same body and idempotency keys.
- A later successful sample closes the telemetry incident, and a fresh sequence
  of failures can page again.
- Real gauge and direct-migration conditions retain their existing recurrence,
  ordering, and retry behavior.
- Telemetry-only copy is calm and explicit that the monitor is blind; it does
  not claim the database is under pressure.
- Missing metric diagnostics contain only canonical allowlisted PlanetScale
  metric names and never raw response data, labels, targets, credentials, chat
  identities, or provider prose.

## Scope

- Cloudflare database-health metric parsing, alert admission, and focused tests.
- Current Cloudflare and reliability owner documentation.

## Constraints

- No metric is made optional and no missing value is treated as zero.
- No new state owner, queue, dependency, external service, or schema migration.
- Preserve the existing transactional sample/admission boundary, global attempt
  fence, destination health checks, and exact-body retry contract.
- Do not deploy from this repository; production deployment remains owned by the
  private deployment workflow after merge.

## Tasks

1. [x] Add bounded missing-family evidence to parse failures and monitoring
   conditions.
2. [x] Admit telemetry-only pages once per uninterrupted incident and make their
   copy truthful while leaving genuine unsafe recurrence unchanged.
3. [x] Add focused parser, retry, recurrence, recovery, and copy regressions.
4. [x] Update the durable operational contract and run focused verification.
5. [ ] Push the exact candidate, open the PR, and complete ReviewGPT plus CI.

## Verification log

- Focused Node Vitest: 3 files and 59 tests passed.
- Focused Workers-runtime Vitest: 1 file and 1 test passed.
- Cloudflare package typecheck passed.
- Raw health/model/vault log guard passed.
- Agent docs drift guard initially required the material owner-doc updates to be
  indexed; `agent-docs/index.md` was synchronized and the rerun passed.
- `git diff --check` passed.
