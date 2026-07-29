# PR 932 Round 19 Provider Fence Retrospective

Status: completed

## Goal

Make the group-reply/account-deletion boundary cover the real external provider
effect, so deletion never removes a group while an authorized group-specific
text is still in flight and never restores same-day suppression without a
surviving delivery fact.

## Retrospective trigger

Round 19 proved that the round-18 PostgreSQL reply-first case held an outer
transaction across provider dispatch, but production passed a root Prisma
client. Production therefore released the group-outreach drain after dispatch
preparation and before the provider request, accepted milestone, and sent
marker. The round-18 suspension fence could consequently let deletion finish
while an authorized group link was still in flight.

This is review-induced and not covered by the round-16 terminal-receipt
retrospective. The repeated mechanism is treating preparation authorization as
authority for a later external effect after the lock that established that
authorization has been released.

## Requirement-level decision

- A group-aware reply admitted before suspension must finish the provider
  request and record its provider-correlated delivery consequence while the
  existing group-outreach drain remains owned. Account deletion waits at that
  drain before its suspension fence can commit.
- If account deletion crosses the drain first, the later reply observes the
  committed suspension and is rejected before provider dispatch.
- Keep `HostedLinqDelivery` as the delivery/terminal-status owner and the
  member/day marker as its shared projection. The drain is only the existing
  serialization primitive; add no state owner, lifecycle, queue, scheduler, or
  retry loop.
- Scope the longer transaction to the group-aware signup effect that needs this
  authority fence. Do not extend unrelated Linq effects across provider calls.

## Work

1. Reconcile the latest `origin/main` durable account-deletion cleanup owner,
   preserving its receipt and retry architecture.
2. Replace the false reply-first PostgreSQL boundary with a root-Prisma-client
   reproduction whose provider barrier is outside dispatch preparation.
3. Keep the group-aware provider request, accepted delivery consequence, and
   sent-marker projection inside one existing drain-owning transaction.
4. Prove both production orderings with one deletion request: reply-first
   completes before deletion, and deletion-first prevents provider dispatch.
5. Prove external cleanup runs exactly once, the group and correlations are
   removed, and no marker is restored without surviving delivery truth.
6. Run focused unit/PostgreSQL proof, Web typecheck/lint, canonical diff and
   acceptance verification, then exact-head CI and ReviewGPT.

## Evidence

- ReviewGPT round 19 reviewed `994a53e84e75` on the requested Pro model and
  returned `RETROSPECTIVE_REQUIRED`.
- Static tracing confirms production commits
  `prepareHostedLinqSideEffectProviderDispatch` before
  `sendHostedLinqChatMessage`, while the prior reply-first PostgreSQL case
  passed a transaction client through both operations.
- Latest `origin/main` is `9b7cdb0c7770` and adds durable deletion-cleanup
  receipt ownership; reconciliation conflicts are limited to the testing map,
  account-data service, and its unit suite.
- Reconciled that base in merge commit `47bb4dfba6`, preserving the durable
  cleanup receipt/preparation/run owner and the group suspension/drain fence.
- The corrected root-client PostgreSQL proof failed before the implementation:
  deletion crossed the drain while the provider barrier remained held. After
  the fix, all five PostgreSQL recovery/concurrency cases pass, including both
  deletion/reply orderings and exactly-once durable external cleanup.
- Focused Linq transport/idempotency tests pass (79 tests), the broader focused
  Web set passes (141 tests), Web typecheck passes, and targeted lint passes
  with one unchanged unused-argument warning in the group outreach store test.
- Canonical diff run `tbx_01kygz97165wm5tyext5azqb4f` exposed that fence
  detection preceded identity resolution and consumed generic-path mocked
  reads in the wrong order. Resolving the dispatch identity first fixed the
  production/test ordering without changing generic behavior.
- Canonical diff rerun `tbx_01kygzgtgqqt72q3jxc0d6887z` passes: 545 test
  files passed, 14 skipped; 6,966 tests passed, 193 skipped; build, lint,
  typecheck, development smoke, and workspace guards all passed.
- Canonical acceptance run `tbx_01kygznmnzjtscc881tys5jr82` passes, including
  all package/application verification and 1,992 Cloudflare tests.

Updated: 2026-07-27
Completed: 2026-07-27
