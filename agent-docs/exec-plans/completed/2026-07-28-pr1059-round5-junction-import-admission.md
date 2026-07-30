# Close Junction pull admission after ReviewGPT Round 5

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Keep established Junction siblings runnable while excluding a newly started,
  disconnected target from provider projection and every durable import path.
- Preserve legacy source-row absence only when no row exists for that provider.
- Stay within the existing source and import owners without adding state,
  queues, managers, or compensating lifecycle machinery.

## Evidence

- Round 5 ReviewGPT traced account-wide Junction summary and timeseries reads
  through sanitization and durable import while the account remains established.
- `executeJob` filters the provider list before identity resolution, but the
  account-wide payload can still contain records for a disconnected provider.
- `projectJunctionSources` can currently promote an existing disconnected row,
  conflicting with the runtime hook's sole admission ownership.

## Tasks

1. [x] Reproduce disconnected-target projection/import with the real Junction
   provider boundary.
2. [x] Separate complete identity resolution from currently admitted sources.
3. [x] Re-read source admission before projection and each durable import.
4. [x] Add production-faithful summary, timeseries, queued, and in-flight proof.
5. [x] Update durable docs and the round-cap retrospective.
6. [x] Run focused, canonical, acceptance, parent review, commit, push, and
   exact-head CI. Pause ReviewGPT at the five-round cap.

## Verification

- The focused real-provider regression and the queued service/import-boundary
  regression pass.
- `pnpm test:diff packages/device-syncd apps/web apps/cloudflare` passes.
- `pnpm verify:acceptance` passes under the repository's conservative
  single-worker profile.
- Parent final review found no unresolved accepted or actionable finding.
- ReviewGPT is paused after substantive Round 5; Round 6 requires explicit user
  authorization.
Completed: 2026-07-28
