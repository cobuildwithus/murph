# PR 454 ReviewGPT Round 6 Fix

Status: completed
Created: 2026-07-08
Updated: 2026-07-07

## Goal

- Fix the accepted Mountain ReviewGPT round-6 finding for PR 454: group-newsletter email-needed imports must not let stale restored assistant-session routing override the wake's newly proven direct route.

## Success criteria

- When a wake carries `directRoute`, the importer stages the private missing-email nudge on that route.
- Legacy wakes without `directRoute` still use an existing current direct assistant session when one exists.
- Focused regression coverage proves a stale current session cannot shadow wake-level direct route authority.
- Verification, scoped commit, push, and Mountain ReviewGPT rerun complete, or any remaining finding is explicitly triaged.

## Scope

- In scope:
  - `group-newsletter.email-needed` mailbox import route selection.
  - Assistant-runtime tests for wake-route precedence and legacy fallback.
- Out of scope:
  - New persisted routing state, schedulers, rollout machinery, or unrelated mailbox import behavior.

## Constraints

- Preserve the existing legacy fallback for wakes produced before `directRoute`.
- Keep server-proven wake authority as the source of truth when available.
- Keep the fix small and composable.

## Tasks

1. Prefer `wake.directRoute` over restored current assistant-session routing.
2. Add focused regression coverage for stale session shadowing.
3. Run required verification.
4. Commit, push, and rerun Mountain ReviewGPT.

## Decisions

- Accept the Mountain round-6 finding based on code-path evidence: the importer currently computes `currentSessionRoute ?? wakeRoute`.
- Prefer reordering the existing route sources over adding new persisted state or matching machinery.

## Verification

- Commands to run:
  - Focused assistant-runtime group-newsletter mailbox tests.
  - `pnpm typecheck`.
  - `pnpm test:diff`.
Completed: 2026-07-07
