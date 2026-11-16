# Renew completed reconcile content proofs

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Outcome and scope

Allow unchanged scheduled Junction reconciles to use the existing Web preflight
after daily repair. Preserve the six-hour cadence and every authority boundary.
This applies to all members and is independent of dormant-member policy.

Product UX effort: Patch. Reaches background device scheduling only. Proof:
unchanged data may skip a container; changed data, pending work, read failure,
or expired authority retains the existing runtime path. Foreground admission,
replies, typing, standby, and idle windows are untouched.

## Reproduction before changing source

Fake-time tests passed against the original provider and Web owners. A reconcile
at 20:00 local followed by four six-hour probes exposed the renewal gap: the
first reconcile after UTC midnight completed daily repair but retained the
expired proof. An immediate second full reconcile minted a valid proof.

| Zone and initial instant | First expiry | Before skips / four | After skips / four |
| --- | --- | --- | --- |
| UTC, April 3 20:00Z | April 4 00:00Z, UTC/local midnight | 1 / 4 | 2 / 4 |
| New York, April 4 00:00Z (20:00 local) | April 4 04:00Z, local midnight | 1 / 4 | 1 / 4 |
| Tokyo, April 3 11:00Z (20:00 local) | April 3 12:00Z, provider closure | 1 / 4 | 2 / 4 |

These are controlled unchanged-data examples, not fleet savings. New York's
local midnight, noon UTC provider closure, and UTC midnight occupy three
different probe intervals. One container per day cannot satisfy those existing
boundaries without changing the authority or window contract. DST can introduce
an earlier fixed-elapsed temporal-authority boundary as well.

## Chosen design

1. Delete the profile/daily-repair exclusion from proof creation. These are
   reasons for doing work, not reasons to discard its completed evidence.
2. Carry the existing optional `reconcileProof` through the existing bounded
   timeseries cursor. Append only the latest globally closed calendar-day
   collections in the same resource order as Web's probe, using fetched data.
3. Include empty collections; preserve the batch owner's deferred source fence.
   Require structurally complete collections when collecting proof evidence.
4. Publish after the timeseries continuation completes. Skip/error or expiry
   drops evidence rather than extending it. No extra provider request is added.
5. A summary/closed-day proof may coexist with temporal-repair siblings; Web's
   existing dirty/mailbox/history gates still prevent skipping pending work.

No metadata encoding, content binding, schedule, queue, table, flag, or state
owner changes. The existing optional payload field is already in hosted hints.

Rejected: extend expiry — violates real authority boundaries.
Rejected: retry a second full reconcile to mint proof — repeats provider work.
Rejected: move the next due time — changes freshness and does not repair evidence.

## Failure and deployment boundaries

- Runner first: unchanged Web reads the same proof encoding and digest contract.
- Web first: old runner checkpoints remain accepted only inside their original
  expiry. Old continuations without proof finish safely without creating one.
- A rollback runner can drop the carried optional proof; this loses savings,
  not data. No migration, backfill, or simultaneous rollout is required.
- Dirty rows, pending mailbox work, inventory changes, history/recovery,
  consent, CAS races, and provider failures retain their current Web gates.
- A boundary crossed during a continuation drops its proof; completion never
  renews the original expiry. Pending temporal repair remains independently owned.

## Verification and production proof

- Provider owner: real fetch/import/digest path with fake time; UTC/local/provider
  closure, spring/fall DST, profile and daily repair, empty collections,
  corrections, unavailable reads, failed imports, failed source reads,
  pre-change proof bytes, and an old runner dropping the optional field.
- Web owner: boundary fallback/renewal plus existing dirty, payload, mailbox,
  consent, timeout, history ownership, and authority/CAS race tests.
- Broader Junction tests and package typecheck; Web focused tests and typecheck.
- Self-review, complexity diff, documentation checks, scoped commit and draft PR;
  verify the pushed head is draft before Ready. No ReviewGPT, merge, or deploy.
- After a separately authorized rollout, compare complete UTC-day aggregate
  preflight reasons and scheduled reconcile invocations against the same cohort
  and deployment baseline. Expect fewer `baseline_expired` fallbacks and more
  `content_unchanged` skips, without drops in applied imports or worse foreground
  latency. Changed/dirty/history failures must continue to wake.

The complete Vercel reason distribution was skipped: prior wide reads timed out
and the available log route has not established a cheap, complete aggregate.
The earlier 170-probe sample is not a fleet distribution. Actual saved wakes,
provider behavior, checkpoint-to-Web propagation and production latency remain
unproved until rollout; do not claim all 126 no-applied roots/day disappear.

## Local results

- `pnpm --filter @murphai/device-syncd test junction`: 787 tests passed in 28 files.
- `pnpm exec tsx apps/web/scripts/run-hosted-web-vitest.mts apps/web/test/device-sync-scheduled-reconcile-preflight.test.ts`: 31 tests passed.
- `pnpm --filter @murphai/device-syncd typecheck` and
  `pnpm --filter @murphai/hosted-web typecheck`: passed.
- `pnpm complexity:diff`: passed, debt 312 to 312 and maximum 95 to 95.
  Reviewed the existing large provider functions; kept proof lifetime/window
  checks beside the existing proof helpers instead of adding orchestration.
- `pnpm docs:drift` and `git diff --check`: passed.
- The pre-change and candidate probe bodies are byte-identical; the metadata
  encoder and Web admission owner are unchanged. New repair proofs therefore
  exercise the old reader in the provider tests. The captured pre-change proof
  test covers the opposite deploy order. This is local compatibility evidence,
  not a live mixed-deployment claim.
- Changelog: not applicable; internal execution-cost reduction with unchanged
  freshness and member behavior. Parent self-review: Ready for external review.
Completed: 2026-11-10
