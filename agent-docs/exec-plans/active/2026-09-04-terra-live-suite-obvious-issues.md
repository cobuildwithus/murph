# Terra live-suite failures

Status: active
Created: 2026-09-04
Updated: 2026-09-04

## Goal

Complete the existing live Terra sweep, distinguish assertion defects from
unsuccessful assistant journeys, and fix obvious reproducible issues on current
main without disturbing the running baseline.

## Success criteria

- Account for every journey in the existing sweep, including blocked results.
- Prove each accepted cause before changing its owning boundary.
- Preserve actual effect assertions while excluding read-only CLI help.
- Run focused deterministic tests, package typecheck, and relevant live journeys.
- Review actual synthetic replies, commit the scoped patch, and complete the
  required PR checks.

## Scope

- Confirmed assistant and live-test defects exposed by the sweep.
- No speculative rewrites, production-provider calls, or private member data.
- Changes use an isolated task branch based on current main; baseline results
  remain tied to their original revision.

## Product UX: Patch

- Outcome: supported requests use available results and report completed work
  truthfully; verification measures actual writes instead of help inspection.
- Reaches: direct and group video questions, and any other existing journey
  whose independently reproduced failure admits a small correction.
- Proof: production-composed synthetic turns, exact tool results and effects,
  and manual inspection of the resulting replies.

## Tasks

1. Finish observing the original sweep and classify failures.
2. Reproduce promising failures on current main and inspect owning code paths.
3. Correct proven causes with focused deterministic regression coverage.
4. Run typecheck and affected live journeys; inspect replies and effects.
5. Review scope, document evidence, close this plan, and open the scoped PR.

## Decisions

- Do not modify or terminate the original session's active test runner.
- Current main contains a newer deferred-schema discovery fix; do not duplicate
  it or assume old-revision failures remain current.
- Keep logs and synthetic transcripts in ignored local evidence only.

## Verification

- Baseline: existing two-process live sweep, model gpt-5.6-terra, local subscription.
- Fixes: selected live tests plus focused deterministic proof and assistant-engine
  typecheck. Record exact commands and results as they complete.
