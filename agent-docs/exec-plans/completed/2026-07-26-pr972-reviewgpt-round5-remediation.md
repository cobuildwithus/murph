# PR 972 ReviewGPT Round 5 Remediation

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Resolve the qualifying ReviewGPT round 4 same-created funding finding with
  the smallest correction to aggregate replay.

## Scope

- Fully unwound and partially represented paid updates that share Stripe's
  one-second creation timestamp.
- Lookup-level and Family projection regressions, canonical verification, PR
  evidence updates, and correction-only ReviewGPT round 5.

## Constraints

- Retain every invoice in a causally ambiguous same-created group only while
  some aggregate contribution from that group remains represented.
- Do not add ordering heuristics, persisted state, billing owners, or
  reconciliation mechanisms.
- Keep the existing member and Family projection owners unchanged.

## Tasks

1. Add failing regressions for fully unwound and partially represented
   same-created increases.
2. Remove the invoice-count override after aggregate replay proves a group is
   fully unwound.
3. Prove the healthy fully unwound outcome through the exact Family projection.
4. Run focused tests, canonical diff verification, and full acceptance.
5. Finish the plan, commit, push, update PR evidence, and run correction-only
   ReviewGPT round 5 concurrently with CI.

## Evidence

- ReviewGPT round 4 reviewed exact head
  `4085e2b7f252148ec2f837e198c96c0a33acfa4b` and reported one qualifying
  review-induced finding.
- Before the source correction, the focused lookup suite passed all 52
  existing and partially represented cases while both fully unwound
  same-created refund cases failed.
- After the correction, the lookup and projection suites pass 108 tests, and
  the seven related recurring billing/event/webhook suites pass 258 tests.
  Scoped ESLint, the Web TypeScript check, and `git diff --check` also pass.
- Canonical diff verification passed in Blacksmith Testbox
  `tbx_01kygfd6vfd3c3qft5wjm47btw`, including the full Web build and 7,176 Web
  tests.
- Full repository acceptance passed in Blacksmith Testbox
  `tbx_01kygfhr8ss0ftwrjf88m4cqsq`.
Completed: 2026-07-26
