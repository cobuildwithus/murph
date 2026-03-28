# Hosted Execution Architecture Improvements

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

Integrate the supplied `hosted-execution-architecture-improvements-combined.patch` into the current repo shape without discarding newer hosted-runtime, Cloudflare, or hosted-web edits already in flight.

## Scope

- Compare the supplied patch against the current worktree and identify which behaviors are still missing versus already landed in a different structure.
- Land the remaining shared hosted-execution seam changes across:
  - `packages/hosted-execution` shared callback-host/default-base-url primitives plus canonical dispatch lifecycle and outbox payload helpers
  - `apps/cloudflare` keyring-aware encrypted bundle/object reads, shared helper adoption, and aligned journal/outbox/callback host usage
  - `packages/assistant-runtime` adoption of the shared hosted-execution helper surface
  - `apps/web` adoption of the shared hosted-execution outbox payload/lifecycle helpers
- Update directly affected docs/tests/config only where needed to keep the landed behavior truthful.

## Constraints

- Preserve unrelated dirty edits already present in overlapping hosted-runtime, onboarding, device-sync, and assistant lanes.
- Treat the supplied patch as a behavioral reference, not as a file-for-file authority over the current branch.
- Keep the hosted execution transport, outbox, and encrypted-bundle boundaries aligned with the current architecture docs and package ownership rules.
- Do not widen this lane into unrelated onboarding, device-sync, or assistant-runtime refactors unless a tiny compatibility fix is required.

## Risks

1. The supplied patch was cut against an older tree and overlaps files with newer structural changes already in progress.
   Mitigation: port the intended behavior manually into the current shapes instead of force-applying stale hunks.
2. Shared helper extraction can drift from existing public package entrypoints or current tests if symbols moved since the patch was generated.
   Mitigation: inspect package exports, contract tests, and current callers first, then adapt the abstraction to the current package surface.
3. Repo-wide verification may still encounter unrelated failures because the worktree is already dirty.
   Mitigation: run focused checks while integrating, then run the required repo commands and explicitly separate unrelated blockers if they remain.

## Verification Plan

- Focused hosted-execution, hosted web, assistant-runtime, and Cloudflare tests while integrating the behavior.
- Required repo commands after integration:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Required completion-workflow audit passes via spawned subagents:
  - `simplify`
  - `test-coverage-audit`
  - `task-finish-review`

## Working Notes

- The current tree already contains shared hosted-execution helpers such as `outbox-payload.ts`, `dispatch-ref.ts`, and `side-effects.ts`; this lane should extend or consolidate them instead of duplicating patch-era seams.
- Cloudflare and hosted-web files in scope are already dirty from active hosted reliability/onboarding/device-sync work, so every edit here must be narrow and adjacency-safe.
Completed: 2026-03-28
