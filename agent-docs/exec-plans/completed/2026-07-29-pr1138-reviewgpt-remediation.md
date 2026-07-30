# PR 1138 ReviewGPT remediation

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Resolve the two accepted final-review findings without adding another state
  owner or lifecycle.
- Preserve the stricter exact-Linq-iMessage authority added by the stacked base.
- Land the composable usage-mission behavior with exact-head proof.

## Findings

1. One policy could be armed for different reward destinations, while the next
   group advanced only the newest row.
2. Explicit selection of both policies used two mutations, so capacity changes
   could leave only half of the selected set armed.

## Correction

- Restore one unbound armed row per referrer and policy across destinations.
- Keep destination-scoped mission details private while suppressing a policy
  already armed elsewhere from the available-policy projection.
- Make one arm request commit the exact selected policy set atomically under the
  existing referrer lock and database transaction.
- Delete newest-per-policy binding arbitration and bind every compatible armed
  row.

## Tasks

1. [x] Merge the advanced stacked base and preserve both its exact channel
   authority and this PR's plural behavior.
2. [x] Implement the two accepted corrections in the existing referral owner,
   wire contract, assistant guidance, schema migration, and durable spec.
3. [x] Add focused unit, parser, runtime, PostgreSQL, race, and migration proof.
4. [x] Run affected tests, typechecks, Prisma and migration checks, identifier
   scan, and parent final review.
5. [x] Prepare the exact candidate and PR contract for final ReviewGPT
   correction verification and exact-head CI.

## Post-plan PR gate

After this plan is archived and the final candidate is pushed, require a
zero-finding final ReviewGPT correction round and green exact-head CI. Then
merge the PR and retire the clean task worktree through the repository helper.

## Constraints

- Add no service, queue, coordinator, compatibility layer, or assistant-owned
  product state.
- Keep cancellation singular and destination-scoped.
- Keep rewards, caps, identity, provider authority, expiry, and anti-abuse
  checks server-owned.
- Preserve unrelated changes from the stacked base.
Completed: 2026-07-29
