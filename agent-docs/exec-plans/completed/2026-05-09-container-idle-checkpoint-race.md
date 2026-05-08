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

- Commands to run: focused Cloudflare tests for runner lifecycle, `pnpm --dir apps/cloudflare verify` or truthful scoped equivalent.
- Expected outcomes: focused tests pass; broader verification either passes or reports unrelated blockers precisely.
Completed: 2026-05-09
