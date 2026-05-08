# Container idle checkpoint ownership

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Make the Durable Object the sole owner of the five-minute idle-shutdown checkpoint by ensuring the runner container's own idle expiry is only a later fallback.

## Success criteria

- The DO schedules the idle-shutdown checkpoint at the externally visible five-minute quiet window.
- The container `sleepAfter` fallback is materially later than the DO checkpoint window.
- Starting the idle checkpoint renews container activity/liveness before checkpoint work begins.
- The idle checkpoint success/failure path explicitly destroys or stops the warm container.
- Focused tests cover that container activity expiry cannot stop the container before the DO checkpoint invocation starts.

## Scope

- In scope:
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/user-runner.ts`
- focused `apps/cloudflare/test/**` coverage for the idle checkpoint race
- Out of scope:
- Broad hosted-local runner refactors, hosted web changes, and unrelated dirty worktree fixes.

## Constraints

- Technical constraints:
- Preserve the existing five-minute user-visible idle behavior.
- Keep the container idle expiry as a fallback, not as the normal checkpoint owner.
- Do not weaken hosted execution auth, lease, or cleanup boundaries.
- Product/process constraints:
- Preserve unrelated active worktree edits and overlapping Cloudflare runner work.

## Risks and mitigations

1. Risk: overlapping dirty runner files make a scoped commit unsafe.
   Mitigation: keep the diff narrow, report exact blockers, and close the plan if committing is unsafe.
2. Risk: changing idle timing can hide stale warm containers.
   Mitigation: keep DO explicit destroy/stop after idle checkpoint and set only the fallback TTL later.

## Tasks

1. Trace current runner TTL and idle checkpoint scheduling.
2. Patch the fallback TTL and liveness renewal path.
3. Add focused regression coverage.
4. Run scoped Cloudflare verification and required audits.
5. Close or commit the plan depending on dirty-worktree safety.

## Decisions

- Use a five-minute DO idle checkpoint window and add a two-minute container fallback grace, giving default `sleepAfter` of seven minutes.
- Keep `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS` as the externally visible idle checkpoint window; the container derives its fallback TTL by adding the grace internally.

## Verification

- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/env.test.ts` (87 tests).
- Passed: focused lifecycle regression selection over `runner-container.test.ts`, `user-runner-alarm.test.ts`, and `env.test.ts` (8 tests).
- Passed: `pnpm --dir apps/cloudflare typecheck` before later overlapping Cloudflare edits landed.
- Passed: `pnpm exec vitest run packages/hosted-execution/test/hosted-runtime-control.test.ts` after allowing checkpointed results to preserve `nextWakeAt`.
- Passed: `pnpm --dir packages/hosted-execution test:coverage` (18 files, 111 tests).
- Passed: `git diff --check` on touched paths.
- Failed after unrelated overlapping edits landed: `pnpm typecheck` now fails in `apps/cloudflare/src/index.ts`, `apps/cloudflare/src/user-runner.ts`, and `apps/cloudflare/test/index.test.ts` with duplicate implementation/property errors outside this task's scoped changes.

## Audit notes

- `coverage-write`: no edits; existing tests were sufficient for the idle-checkpoint ownership chain.
- `security-privacy-review`: found a parser contract mismatch for `idleShutdownCheckpointed: true` plus later `nextWakeAt`; fixed in `packages/hosted-execution`.
- `task-finish-review`: flagged an overlapping dashboard/browser-vault refresh lifecycle issue from a different active row. Left out of scope for this task.
Completed: 2026-05-09
