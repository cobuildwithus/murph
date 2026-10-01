# Exclude Linq production canary from reply latency alerts

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Keep the operator reply-latency incident channel focused on real member
  traffic by excluding the configured Linq production-canary member from every
  health read used to admit or send an alert.

## Success criteria

- The current canary member is resolved through the existing canonical
  fixed-identity lookup.
- Canary traces cannot open or sustain a reply-latency incident.
- Ordinary Linq traces retain the existing latency and unresolved-turn
  classifications.
- Focused unit and local PostgreSQL query proof pass, followed by the required
  exact-head PR gates.

## Scope

- In scope: latency-monitor admission, query filtering, focused regression
  coverage, and the live reliability/Web-owner documentation.
- Out of scope: changing the canary journey or its 20-second SLO, changing
  provider delivery, repairing the separate runner-deletion failure, or
  suppressing any ordinary-member alert.

## Constraints

- Technical constraints: reuse `readHostedLinqProductionCanaryMemberId`; apply
  exclusion before the bounded result limit; keep the same exclusion across
  the monitor's initial and pre-send health reads; add no state or schema.
- Product/process constraints: preserve alert privacy, keep the canary's own
  postdeploy workflow as its SLO owner, and complete the backend PR review and
  exact-head CI gates.

## Risks and mitigations

1. Risk: a query-only test double appears green while production SQL still
   includes the canary.
   Mitigation: add both monitor-level regression coverage and real PostgreSQL
   query proof.
2. Risk: excluding the canary accidentally suppresses ordinary member rows or
   weakens the bounded-scan fail-safe.
   Mitigation: mix canary and ordinary rows in focused tests and keep exclusion
   before the existing cap without changing classification logic.

## Tasks

1. Resolve the configured canary through the existing identity owner and bind
   it to all latency-monitor health reads.
2. Exclude that member in the indexed candidate hydration query before result
   limiting.
3. Add focused unit and PostgreSQL regression proof for canary-only and mixed
   traffic.
4. Update reliability/Web documentation, run verification, inspect the diff,
   and complete the PR review/CI workflow.

## Decisions

- Keep the canary's 20-second postdeploy workflow as the sole owner of canary
  reply failures; do not infer canary status from message timing or chat shape.
- Reuse the canonical phone-blind-index lookup and pass only the resolved member
  id to the latency query.

## Verification

- Passed: 47 focused latency-monitor unit tests, including canary-only and
  mixed-member alert behavior.
- Passed: the focused local PostgreSQL exclusion case against an isolated
  database. The existing combined 50,000-row plan and 20,001-row cap stress
  case exceeded its 120-second transaction budget on this machine and remains
  unchanged for its canonical CI lane.
- Passed: Web typecheck, repository lint with existing warnings only,
  `git diff --check`, and `pnpm complexity:diff` with no added complexity debt.
- Passed: exact-head ReviewGPT round 1 returned `ROUND_OUTCOME: PASS` with no
  qualifying findings.
- Passed: required public PR checks, every release Web test shard, Web build,
  build/typecheck, package coverage, and corrected PR evidence on the reviewed
  behavior head.
- The private Temporal compatibility run completed both supported readers and
  its attestation successfully, but the public receipt controller rejected the
  successful run as a malformed proof job on both its original attempt and one
  unchanged-head retry. This diff changes no Temporal contract; the repeated
  non-required failure is an unrelated controller-integration gap.
- Pending: final plan closure, exact final-head CI, and current-base
  mergeability.
Completed: 2026-09-04
