# Linq health round-2 retrospective correction

## Goal

Resolve the two accepted ReviewGPT round-2 findings on PR #1118 without adding
another state owner, repair loop, or delivery path.

## Retrospective decision

- Continue the original migration. Its user outcome remains one independent
  provider projection and one existing egress-policy owner.
- Keep the legacy `provider_status` / `provider_updated_at` /
  `last_status_event_id` triplet frozen and coherent for prior Web functions.
  Current code writes only the independent service and reputation clocks plus
  provider observation time.
- Preserve final old-build writes through the existing post-drain contract
  migration, then perform the required delivery-health semantic cutover.
- Treat successful execution of that contract migration as the Web rollback
  floor. Recovery is a forward redeploy of that revision or a later compatible
  Web revision; a pre-PR Web build is not a valid rollback target afterward.
- Prove the exact SQL transition with PostgreSQL rather than adding a repair
  mechanism or relying on mocked writes and SQL text assertions.

The immutable first-reviewed source baseline remains 1,322 additions and 310
deletions. The round-2 reviewed source shape was 1,380 additions and 310
deletions. The correction removes the cross-dimension shared-clock write and
adds only the direct transition proof and durable rollback contract.

## Verification

- Partial and reordered service/reputation updates keep independent clocks.
- The legacy compatibility triplet never pairs one status with another
  dimension's timestamp or event id.
- Exact post-drain SQL preserves newer coherent legacy writes without
  overwriting newer dedicated `FLAGGED` or `CRITICAL` state.
- Exact post-drain SQL reconstructs delivery health only after the documented
  rollback floor.
- Merged-head assistant cron tests preserve both newsletter settlement and Linq
  posture behavior.
- Focused tests, affected typechecks, exact-head CI, and a later ReviewGPT
  correction round pass.
Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
