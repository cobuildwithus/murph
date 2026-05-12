# Fix explicit destroy during runner cold start

Status: completed
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Make explicit hosted runner cleanup abort and wait for a cold-starting workspace invocation, so account deletion/container cleanup cannot report success while the runner continues starting work.

## Success criteria

- `destroyInstance()` aborts an invocation even when it is still inside container readiness/cold start.
- Lifecycle `onStop()`/`onError()` remain observational and do not abort newer work.
- Readiness startup receives the invocation abort signal and combines it with the existing readiness timeout.
- The prior cold-start test that expected successful completion after explicit destroy is replaced with a regression test for abort/preemption.

## Scope

- In scope:
- `apps/cloudflare/src/runner-container.ts`
- Focused runner-container tests under `apps/cloudflare/test/runner-container.test.ts`
- Out of scope:
- Broader hosted runner lifecycle refactors, user-runner alarm behavior, deploy wiring, or production Cloudflare API changes.

## Constraints

- Technical constraints:
- Preserve the stale-lifecycle-hook protection by keeping `onStop()` and `onError()` logging-only.
- Do not add new persisted state.
- Preserve existing warm-container stop semantics except for waiting under the lifecycle lock after explicit destroy.
- Product/process constraints:
- Coordinate with overlapping hosted-runner active rows and preserve unrelated worktree edits.
- Avoid exposing local personal identifiers in generated docs, logs, or commit text.

## Risks and mitigations

1. Risk: Reintroducing lifecycle-hook aborts could cancel a newer invocation.
   Mitigation: Only publish an invocation abort controller from the active invocation path and keep lifecycle hooks observational.
2. Risk: Destroy waits can deadlock if the lifecycle lock is misused.
   Mitigation: Inspect existing lock helpers and add a direct regression test around cold-start destroy.

## Tasks

1. Inspect `RunnerContainer` invocation, readiness, lifecycle lock, and current cold-start destroy tests.
2. Publish the operation abort controller before readiness starts and clear it only if still current.
3. Thread the operation abort signal into readiness/startup timeout handling.
4. Update tests to assert explicit destroy aborts or preempts cold start.
5. Run focused verification plus required repo checks/audits.

## Decisions

- Use explicit destroy as an authoritative cleanup path; lifecycle callbacks remain observational only.
- Publish the invocation abort controller and attempt metadata during readiness so explicit destroy and attempt-scoped abort can interrupt cold start without relying on lifecycle hooks.

## Verification

- Commands to run:
- Focused runner-container test or `pnpm test:diff apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts`
- Required app/repo checks per verification routing, unless blocked by unrelated pre-existing failures.
- Expected outcomes:
- Focused regression passes and typecheck/required verification stay green or any unrelated blockers are reported with evidence.
- Results:
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-container.test.ts --no-coverage` passed: 60 tests.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `git diff --check -- apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts agent-docs/exec-plans/active/2026-05-12-runner-destroy-cold-start-abort.md` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts agent-docs/exec-plans/active/2026-05-12-runner-destroy-cold-start-abort.md` failed before app tests on unrelated repo TS-tool errors in `scripts/murph-age/r399-midus2-biomarker-increment.ts` (`uniqueColumns` missing, arity mismatch).
- `pnpm --dir apps/cloudflare verify` failed in unrelated `apps/cloudflare/test/runner-platform.test.ts` expectations because the dirty `apps/cloudflare/src/runtime-platform.ts` change makes fetch mocks receive a `Request` object where the test expects the URL string.
Completed: 2026-05-12
