# PR 784 Round 6 Combined-Authority Remediation

## Goal

Preserve independent typed group-task and audience authority when a scheduled
automation is also owned by an experiment, habit, or supplement support plan.
Withhold only a plan-owned generic notification from the model envelope while
retaining the original scheduled-task authority for parent-side admission,
source freshness, route freshness, delivery, and commit checks.

## Root Cause

The round-6 plan-snapshot correction derived one
`turnScheduledTaskAuthority` value and reused it for two different purposes:
model-visible scheduled reads and trusted-parent group enforcement. A non-null
plan snapshot changed that value to `none`, so a valid support-tagged group
automation lost its independent group route/task checks as well as its model
capability.

## Constraints

- Keep one runner, planner, tool-selection, skill, and response path.
- Add no durable state, authority manager, reconciliation path, or second
  assistant runtime.
- Keep the original scheduled-task authority as the source of truth for every
  parent-side group check.
- Suppress only `generic_notification` at the model-envelope boundary when the
  trusted parent already supplied the exact plan snapshot.
- Preserve task-specific selector-free reads for plan-owned
  `group_health_update` and `group_challenge` automations.
- Preserve local fail-closed behavior and independent plan-owner revocation
  checks.

## Working Set

- `packages/assistant-engine/src/assistant/cron/execution.ts`
- `packages/assistant-engine/test/assistant-cron-runtime.test.ts`
- PR intent/verification text and this plan lifecycle

## Verification Plan

- Add a support-tagged hosted group route-race regression using a real plan
  owner context and prove the current group route blocks delivery after it
  changes.
- Prove the model retains the independent typed group task while receiving no
  generic plan-owner selector.
- Prove the same combined authority fails closed in local execution.
- Run focused cron runtime coverage, assistant-engine typecheck, the truthful
  owner coverage lane, parent final review, privacy/diff checks, and exact-head
  CI after push.
- The normal ReviewGPT cap is already exceeded; do not start another
  substantive review without a fresh explicit continuation decision.

## State

Remediation and scoped completion gates are green; ready to package and push.

## Evidence

- Static inspection reproduced the accepted finding: one derived authority
  value controlled both the model envelope and every parent-side group route,
  source, delivery, and commit barrier.
- The implementation now derives `modelScheduledTaskAuthority` only for the
  turn envelope and suppresses it only when a trusted plan snapshot coincides
  with `generic_notification`. Every parent-side group check continues to use
  the original scheduled-task authority.
- Focused cron runtime coverage passes 152/152 tests. The new combined fixtures
  prove a support-tagged group task fails closed locally and a hosted route
  replacement blocks delivery while `group_health_update` remains the exact
  model task authority.
- Full assistant-engine coverage passes 2,693 tests with 5 intentional skips;
  full workspace typecheck and repository guards pass.
- The required narrow `coverage-write` audit passed with no edits: existing
  generic suppression, lifecycle revocation, and task-source tests compose with
  the new combined runtime fixtures to cover all independent authority paths.
- Parent final review and `git diff --check` pass. The correction adds no state,
  authority abstraction, manager, queue, or second runner.

Updated: 2026-07-19
Status: completed
Completed: 2026-07-19
