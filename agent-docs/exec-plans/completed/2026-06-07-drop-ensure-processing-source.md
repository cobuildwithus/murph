# Drop Ensure-Processing Source From Runtime Wake Boundary

## Goal

Stop forwarding hosted runtime demand `source` across the Temporal -> Cloudflare
-> local runtime wake boundary while preserving Temporal-internal source
selection and legacy replay compatibility.

## Success Criteria

- Temporal workflow keeps demand `source` for internal flag clearing.
- New workflow behavior is gated by a replay-safe `patched()` marker.
- The ensure-processing Activity still accepts legacy `source` inputs but sends a
  source-less Cloudflare request.
- Cloudflare runtime invocation and runner job requests no longer include
  demand `source`.
- Focused hosted Temporal and Cloudflare tests, plus typecheck, pass or have a
  documented unrelated blocker.

## Constraints

- Keep the change narrow and simple; no new compatibility subsystem.
- Do not alter web demand selection semantics.
- Preserve existing deploy/replay compatibility discipline.
- Do not expose secrets or direct personal identifiers in files, logs, commit
  text, or PR text.

## Working Set

- `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
- `packages/hosted-orchestrator-temporal/src/activities/ensure-runtime-processing.ts`
- `packages/hosted-orchestrator-temporal/test/ensure-runtime-processing.test.ts`
- `packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts`
- `apps/cloudflare/src/user-runner/runtime-processing-controller.ts`
- `apps/cloudflare/src/user-runner/runtime-invocation.ts`
- `apps/cloudflare/test/hosted-workspace-invocation.test.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`

## State

- Done: implemented the bounded compatibility patch on a dedicated branch/worktree.
- Done: focused Temporal tests, focused Cloudflare tests, root typecheck, and
  diff-aware owner verification passed.
- Done: required security/privacy, coverage, deep, and final completion reviews
  found no production-code blockers.
- Next: close/archive this plan with the final scoped commit, push the branch,
  and open a PR.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
