# PR 511 ReviewGPT Round 15 Fixes

## Goal

Validate and resolve every actionable ReviewGPT round-fifteen finding for PR
511, then rerun ReviewGPT on the exact pushed head until it reports no further
actionable findings.

## Findings To Prove

1. Determine whether the production mailbox projection drops the accepted
   allowance-period binding before inactive replay gating.
2. Determine whether an exact already-delivered replay can complete locally
   without advancing the web-owned conversation consumed floor.
3. Determine whether the additive migration/cutover can leave a valid retained
   legacy conversation row permanently unbound when no allowance period was
   materialized before migration.

## Constraints

- Preserve one mailbox owner, one usage-period owner, and the distinction
  between import progress and terminal handling progress.
- Add no replay ledger, queue, scheduler, or lifecycle service.
- Keep genuinely ambiguous historical authority fail-closed.
- Preserve provider-free replay for already-delivered rows and never create a
  duplicate reply candidate.
- Preserve mixed-version deployment safety and document any rollout gate that
  production must enforce.

## Working Set

- Hosted mailbox projection/store and internal fetch route tests.
- Assistant-runtime exact replay import/selection/checkpoint path and tests.
- Allowance-period migration/cutover owner, deployment documentation, and
  focused readiness or repair tests if the legacy finding is validated.

## Verification Plan

- Add production-shaped regression proofs for each accepted finding.
- Run relevant web, assistant-runtime, Cloudflare, hosted-execution, and
  orchestration owner tests and typechecks.
- Run required coverage-write and security/privacy audits.
- Run the repo-required full verification, privacy/diff checks, scoped commit,
  push, CI, and exact-head ReviewGPT round sixteen.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
