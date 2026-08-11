# Fix Personal Patterns provider data analysis

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Make Personal Patterns analyze repeated Oura and WHOOP activity against the
  next day's normalized sleep and recovery data when enough evidence exists.

## Success criteria

- A provider-shaped regression fixture produces tested pattern cells.
- Patterns reuses the canonical activity-kind resolver instead of a narrower
  second interpretation.
- Focused query tests and type checks pass.
- Required PR review and exact-head CI pass before merge.

## Scope

- In scope: Personal Patterns factor collection and focused query coverage.
- Out of scope: pattern thresholds, UI design, provider import schemas, and
  persisted data changes.

## Constraints

- Technical constraints: keep one canonical activity-kind interpretation and
  preserve the current matching and evidence thresholds.
- Product/process constraints: do not add private exported health data to the
  repository. Use synthetic provider-shaped fixtures only.

## Risks and mitigations

1. Risk: A broader resolver could turn generic workouts into misleading factors.
   Mitigation: reuse the existing resolver, which already rejects generic kinds.
2. Risk: The observed export mismatch could also involve outcome projection.
   Mitigation: add direct proof for provider-shaped activity plus normalized
   next-day outcomes before choosing the final correction.

## Tasks

1. Add a focused failing provider-shaped regression test.
2. Fix the smallest shared ownership mismatch.
3. Run focused tests and inspect the exact diff.
4. Commit, push, open the PR, complete required reviews and CI, then merge.

## Decisions

- Keep the current statistical thresholds unchanged.
- Treat the exported member data only as local diagnostic evidence.

## Verification

- Commands to run: focused Personal Patterns Vitest suite and the owning query
  package type check.
- Expected outcomes: provider-shaped activity reaches tested cells and all
  existing Personal Patterns behavior remains green.
