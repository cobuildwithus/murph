# PR 972 ReviewGPT Round 5 Invoice Chronology

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Keep recurring Family access tied to canonical current-period Stripe funding
  through refunds, seat changes, tier changes, consolidation, and retries.
- Remove the remaining ambiguity caused by entitlement-changing Stripe
  mutations that do not create an invoice.

## Required Retrospective

Round 3 found that subscription-item identity could not own funding provenance
after a paid tier conversion was consolidated and later downgraded. Round 4
replaced per-item replay with aggregate per-price replay, but still selected a
chronology made only from invoiced transitions. Because the production writer
could downgrade a tier with `create_prorations` and reduce capacity with
`proration_behavior: none`, the reader could not distinguish a paid seat that
moved tiers from a paid seat that was actually removed.

The original requirement is outcome-level: a paid quantity follows licensed
capacity across a tier move, actual capacity removal extinguishes that
contribution, and a later paid addition becomes the new required contribution.
The first reviewed shape used item-identity replay; the round-4 shape used
aggregate replay but grew another causal reconstruction around the same missing
provider fact. Continuing to adjust replay would repeat the failed mechanism.

An overlapping continuation pushed round 5 before this retrospective was
implemented. That head added another replay condition for homogeneous
same-created transitions. ReviewGPT then found the remaining mixed same-created
case: a tier conversion and seat addition can share a provider timestamp, and a
later silent downgrade leaves no financial event that proves whether the paid
contribution was retained or unwound. The first and fifth reviewed shapes
therefore failed for the same requirement-level reason: neither could recover a
provider fact that the writer never recorded.

The selected correction is to constrain the existing Stripe writer boundary:
every mutation that changes aggregate licensed quantities by tier creates its
proration invoice immediately with `always_invoice`. Stripe then owns the
complete current-period chronology already consumed by the bounded recurring
financial reader. Paid increases remain payment-gated with
`pending_if_incomplete`; downgrades and reductions do not add entitlement, so
they apply immediately and their zero/credit invoice records the unwind.
Stripe's automatic credit balance continues applying downgrade credit to the
next invoice. Same-price consolidation and legacy metered-item cleanup remain
non-prorating because they do not change licensed aggregate quantities.

This redesign adds no local provenance ledger, queue, state machine, metadata
protocol, or reconciliation owner. It shrinks the supported transition model:
silent aggregate entitlement changes are no longer produced by Murph.

## Scope

- Make Family tier downgrades and explicit capacity reductions immediately
  invoiced provider transitions.
- Prove the paid-seat/tier-downgrade/refund sequence through the public
  recurring financial read and refund webhook projection.
- Prove paid growth, invoiced reduction, and later paid re-establishment without
  exceeding the bounded six-seat model.
- Preserve cumulative increases, real unwind, consolidation, equal-created
  updates, and paid tier-conversion behavior.
- Update the durable Family billing contract and PR retrospective evidence.

## Constraints

- Keep Stripe as the only provider-side financial source of truth.
- Keep positive recurring changes payment-gated.
- Preserve existing next-invoice credit UX for downgrades.
- Keep non-economic item consolidation non-prorating.
- Do not add persisted provenance or another retry/reconciliation owner.
- The five-round ReviewGPT cap has been reached. Prepare and verify the exact
  correction head, but do not start a sixth round without explicit user
  authorization.

## Tasks

1. Add focused failing regressions for the two round-4 production paths.
2. Change entitlement-decreasing Family writes to `always_invoice`.
3. Update current durable billing semantics and remove obsolete replay claims.
4. Run focused tests, scoped lint/typecheck, canonical diff verification, and
   full acceptance.
5. Finish the plan, commit, push, update the PR retrospective and corrected
   change-shape counts.
6. If the user explicitly authorizes a post-cap review, run ReviewGPT round 6
   against that exact pushed head concurrently with CI.

## Evidence

- ReviewGPT round 4 reviewed `4085e2b7f252148ec2f837e198c96c0a33acfa4b`
  and returned `RETROSPECTIVE_REQUIRED`.
- ReviewGPT round 5 reviewed `a9b4d6704f975d6cc7ee505be8da41e59585a8a1`
  and returned `FINDINGS` for a mixed same-created transition followed by a
  non-invoiced downgrade.
- Stripe's official subscription-update contract says `always_invoice`
  calculates prorations and immediately creates an invoice. Its invoice
  contract says an automatic invoice below the minimum charge is marked paid
  and its amount is carried on the customer credit balance for the next
  invoice.
- Focused Family writer and recurring-financial lookup regressions pass,
  including the mixed same-created retained/unwound cases, the invoiced
  downgrade refund, and the reduce-then-re-establish sequence.
- Scoped ESLint, the hosted-web prepared typecheck, and `git diff --check`
  pass.
- Canonical `pnpm test:diff` passed in one-shot Blacksmith Testbox
  `tbx_01kygmtg7xydzx76s1ee3pt8fa`; its delegated Actions proof is
  `https://github.com/cobuildwithus/murph/actions/runs/30231116178`.
- Canonical `pnpm verify:acceptance` passed in one-shot Blacksmith Testbox
  `tbx_01kygmyvwss7ztk7ctq80behfy`; its delegated Actions proof is
  `https://github.com/cobuildwithus/murph/actions/runs/30231213859`.
- The live Stripe contract lane remains unavailable because the local Stripe
  CLI authentication is expired. Provider-independent mocks and the complete
  acceptance surface pass.
Completed: 2026-07-26
Completed: 2026-07-26
