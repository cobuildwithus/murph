# Two-Week Experiment Baselines

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

Make a two-week prospective baseline the normal Murph experiment policy while
preserving shorter or absent baselines where the protocol has a concrete
measurement, evidence, safety, or burden reason.

## Success criteria

- Most runnable Health Commons experiment plans use a 14-day baseline.
- Existing intervention windows are not shortened when a baseline grows.
- Explicit point-lab and protocol-specific exceptions remain intact.
- Durable product guidance and focused tests make the default and exception
  rule reviewable.
- Required verification, audits, CI, and PR review pass for the exact shipped
  head.

## Scope

- Authored runnable protocol test plans and matching user-visible duration
  copy.
- Health Commons product guidance and catalog policy coverage.
- Static homepage examples only if they claim to represent the normal plan.

## Constraints

- Do not add a second runtime default or mutate already-saved private runs.
- Keep canonical duration ownership in each protocol's `testPlans`.
- Preserve intervention duration, test cadence, and explicitly justified
  baseline exceptions.
- Do not commit generated Health Commons artifacts.

## Tasks

1. Inventory current baseline and intervention windows and classify exceptions.
2. Update eligible authored plans and matching duration copy.
3. Add focused policy coverage and document the canonical rule.
4. Complete required verification and review, then ship the PR when green.

## Evidence

- Protocol-backed run creation reads `testPlan.baselineDays` directly; there is
  no generic seven-day runtime fallback.
- Public and private experiment views derive intervention length from total
  duration minus baseline duration, so baseline changes must preserve the
  authored intervention window explicitly.
Completed: 2026-07-22
