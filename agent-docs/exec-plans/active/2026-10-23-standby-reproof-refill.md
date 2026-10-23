# Replace a failed standby recheck in the same fill lane

Status: active
Created: 2026-10-23
Updated: 2026-10-23

## Goal

- When a periodic readiness recheck of an unclaimed standby slot fails, the
  coordinator's fill lane that observed the failure reserves the replacement
  within its existing bounded budget, instead of leaving zero ready and zero
  provisioning slots until a later claim, ensure or recovery alarm.

## Success criteria

- A synthetic target-one coordinator regression fails on the unchanged source
  (no ready and no provisioning slot after the failed recheck pass) and passes
  with the change: the failed slot is retired and one fresh slot becomes ready in
  the same alarm pass.
- A failed fresh preparation (refill or resume) still stops its lane and keeps
  the existing recovery-alarm backoff; attempts stay within each lane's existing
  `remaining` budget.
- Healthy rechecks cause no extra preparation; claims racing a recheck keep their
  tombstone and claimed slot (existing #4056 coverage); refill concurrency and
  coalescing stay capped at two lanes (existing #3682 coverage).
- Standby `off` mode or a changed effective release does not refill after a
  failed recheck.

## Scope

- In scope: `fillInventory` failure handling in the standby coordinator Durable
  Object, focused coordinator tests, and the Cloudflare README contract sentence.
- Out of scope: standby target/capacity, scheduling, alarms, queues, telemetry,
  slot health semantics, foreground claim policy, typing or reply ordering.

## Constraints

- Technical constraints: reuse the existing bounded loop, SQLite reservations,
  fenced retirement and recovery alarm; no new retry owner.
- Product/process constraints: synthetic fixtures only; no production replay or
  capacity change. The initial candidate phase performs no dispatch, release
  reservation or deployment; coordinated merge and protected deployment may
  follow only after the required review and CI gates and a fresh coordinator
  release preflight.

## Risks and mitigations

1. Risk: an outage that fails every preparation could add one more attempt per
   failed-recheck pass.
   Mitigation: the attempt stays inside the lane's existing `remaining` bound and
   the following failed refill still breaks to the 30-second recovery backoff.
2. Risk: refilling across a mode or release change.
   Mitigation: the next reservation still passes through `rebalance()` and
   `desiredTarget()`, which return zero when standby is off or the release differs.

## Tasks

1. Add focused coordinator regression and controls; record the unchanged-source failure.
2. Continue the lane only after a failed `reproof`; keep `break` for other kinds.
3. Update the README standby recheck sentence.
4. Run focused tests, Cloudflare typecheck and the complexity diff guard.

## Decisions

- Condition on preparation kind at the existing `break` rather than restructuring
  the loop: the failed recheck has already drained its slot, and the next loop
  iteration's reservation already owns refill eligibility and bounds.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/standby-runner.test.ts`
  - `pnpm --dir apps/cloudflare typecheck` (after `pnpm --dir apps/web prisma:generate`)
  - `pnpm complexity:diff`
- Expected outcomes: new regression fails on unchanged source and passes with the
  change; all standby tests, typecheck and the complexity guard pass.
