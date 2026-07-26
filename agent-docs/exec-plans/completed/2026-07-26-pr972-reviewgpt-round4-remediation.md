# PR 972 ReviewGPT Round 4 Remediation

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Resolve the qualifying ReviewGPT round 3 funding-attribution finding without
  adding billing state, another reconciliation owner, or provider-order
  heuristics.

## Scope

- Current-period paid update attribution after multiple tier conversions,
  same-price item consolidation, and a later non-invoiced downgrade.
- Conservative treatment of paid updates that share Stripe's timestamp
  precision and lack a causal ordering signal.
- Lookup-level and webhook-level regressions, canonical verification, PR
  evidence updates, and correction-only ReviewGPT round 4.

## Constraints

- Derive recurring funding from bounded authoritative Stripe invoice history.
- Replay aggregate licensed quantities by price; subscription item identity is
  not economic provenance.
- Preserve every plausibly represented paid contribution when provider facts
  do not prove an ordering.
- Keep the existing member and Family projection owners unchanged.

## Tasks

1. Reproduce the complete conversion, consolidation, downgrade, and refund
   sequence before implementation.
2. Replace per-item funding replay with bounded aggregate per-price replay.
3. Treat equal-created paid updates conservatively without opaque invoice-ID
   ordering.
4. Prove the correct Family projection through the refund webhook path.
5. Run focused tests, canonical diff verification, and full acceptance.
6. Finish the plan, commit, push, update PR evidence, and run correction-only
   ReviewGPT round 4 concurrently with CI.

## Evidence

- ReviewGPT round 3 reviewed product-code head
  `1449bb85fce867224ba07a431f63061cd1ea8269` and reported one qualifying
  review-induced finding.
- Before the implementation changed, the focused lookup suite reproduced three
  failures: the later consolidated conversion was retained, the earlier
  still-represented conversion was dropped, and the second same-created
  cumulative increase depended on opaque invoice-ID ordering.
- Aggregate per-price replay, Family healthy-refund projection, and the
  existing Stripe event/webhook paths pass 256 focused tests across seven
  suites. Scoped ESLint and the Web TypeScript check also pass.
- Canonical diff verification passed in Blacksmith Testbox
  `tbx_01kygcsp5s9cwencj9m931jsy3`, including the full Web build and 7,174 Web
  tests.
- Full repository acceptance passed in Blacksmith Testbox
  `tbx_01kygcy2nvq6jke3cyq1g3cqpg`.
Completed: 2026-07-26
