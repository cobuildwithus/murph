# PR 550 ReviewGPT Corrections

## Goal

Resolve the two accepted final-audit findings for PR 550:

1. Scope hosted CLI bridge bearer authority to one active invocation so a stale
   terminal cannot use a later invocation's route or device-sync authority.
2. Let hosted queue-only foreground automation return after the first complete
   input group that produces current-turn delivery intent, while scheduling the
   remaining groups through the existing wake path.

## Constraints

- Keep same-conversation adjacent inputs grouped in one automation pass.
- Preserve in-flight bridge request draining and fail-closed invocation cleanup.
- Reuse the existing automation wake projection; do not add persisted state,
  queues, or lifecycle machinery.
- Keep the correction isolated to PR 550 and require a new final ReviewGPT audit
  on the exact corrected head.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/cli-runtime-bridge.ts`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- `packages/assistant-runtime/test/hosted-runtime-cli-runtime-bridge.test.ts`
- focused hosted-runtime automation tests
- `packages/assistant-engine/src/assistant/automation/run-loop.ts`
- `packages/assistant-engine/src/assistant/automation/scanner.ts`
- `packages/assistant-engine/README.md`
- focused assistant automation tests

## Verification Plan

- Focused bridge and automation tests covering stale-token rejection, in-flight
  cleanup, group-boundary yielding, grouping preservation, and immediate wake.
- Relevant package typechecks.
- Required diff verification and parent security/privacy, coverage, and deep
  review passes.
- Scoped commit and push, fresh exact-head CI, then one final published
  ReviewGPT 0.5.106 audit on the corrected head.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
