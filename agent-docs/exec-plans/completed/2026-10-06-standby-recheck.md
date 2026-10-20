# Keep standby health checks claimable

Status: completed
Created: 2026-10-06
Updated: 2026-10-06

## Goal and invariants

Keep pristine standby inventory claimable during periodic health observation.
Claims remain atomic; a late health result cannot revive or retire a handed-off
slot. Only initial preparation may start a container. Existing binding fences
and exact orphan cleanup remain authoritative.

## Evidence and design

The coordinator currently changes ready to provisioning for reproof, while the
container preparation RPC holds the binding lifecycle lock and may restart the
process. Keep the existing ready row and advance its check deadline instead.
Use an additive read-only recheck mode on the existing preparation RPC, with a
direct native health request outside the lifecycle lock. Apply results only
while the same slot remains ready inventory. No new table, scheduler or owner.

## Product UX

- Outcome: foreground arrivals can claim and bind the sole ready standby while health is pending.
- Reaches: foreground starts; cold preparation, failed health replacement, and abandoned claims retain their existing owners.
- Proof: deterministic pending-health claim/bind tests, late success/failure/timeout tests, recovery and target-reduction tests.

## Scope and sequence

1. Correct coordinator and container rechecks; update the runtime owner docs.
2. Run focused standby tests, Cloudflare typecheck, complexity guard and parent review.
3. Obtain final ReviewGPT and required CI, then merge the reviewed candidate.
4. Use the protected deployment owner to deploy the fix and reduce production standby target to one; inspect identifier-free telemetry.

## Failure and deployment

Preserve existing SQLite phases so old provisioning rows still recover. Old
callers omit the additive recheck flag and keep initial preparation behavior.
No container HTTP contract changes: the existing health response is sufficient.
Deploy the Worker correction before reducing production inventory. A failed
unclaimed recheck follows existing fenced retirement; claimed results are ignored.

## Verification

- Standby suite: 96 tests passed, including pending native-health binding, claimed
  late success/failure/timeout, unclaimed failure retirement, reset, shrink and cadence.
- Regression control: the three sole-standby claim cases fail against base source.
- Cloudflare typecheck passed after generating the fresh checkout Prisma client.
- Complexity guard passed with no added debt. The three existing runner hotspots
  are unchanged and outside this correction.
- Parent review: no new state owner, credentials, member data, or awaited foreground
  work. Product UX: Ready for review; production verification follows deployment.
- Final ReviewGPT, exact-head CI, merge and protected rollout are tracked on the PR
  and in the task session. This record closes the implementation phase only.
Completed: 2026-10-06
