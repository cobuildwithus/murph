# Land supplied run-centric hosted patch intent into the moved tree

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Land the supplied run-centric hosted patch into the current repo without widening it into the broader hosted-runtime or Cloudflare refactors already active in this worktree.
- Preserve the intended behavioral fixes: ingress/run-centric public naming, partial contiguous commit handling, explicit `running` hosted-run lifecycle support, and the hard cut away from stale `assistantNextWakeAt` residue where this patch still applies.

## Success criteria

- Current hosted run contracts, parsers, stores, and runner code use the run-centric public names from the supplied patch where those seams still exist in the moved tree.
- Hosted run commit/recovery logic no longer strands acquired-but-uncommitted ingress events when a run commits only contiguous progress.
- Hosted runs can visibly enter `running` in the web-observable lifecycle where the current architecture expects that phase.
- No new wake-shaped public fields or stale `assistantNextWakeAt` allowances are reintroduced while reconciling conflicts.

## Scope

- `apps/web/**` files directly coupled to hosted run contracts, parsers, routes, and stores touched by the supplied patch intent
- `apps/cloudflare/**` files directly coupled to run acquisition/drain/logging touched by the supplied patch intent
- `packages/hosted-execution/**` files directly coupled to hosted run contracts/parsers
- directly coupled tests and durable docs only where the current tree requires them to keep the run-centric protocol truthful

## Constraints

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Preserve overlapping dirty-tree edits and active-plan ownership in the hosted runtime, Cloudflare, and hosted web files already in flight.
- Do not broaden into unrelated hosted onboarding, share, device-sync, or general wake-word cleanup outside the seams required to land this patch cleanly.

## Risks and mitigations

1. Risk: The repo has already moved past some wake-shaped seams, so a blind apply could regress newer run-centric work.
   Mitigation: Inspect current owners first, then port only the still-relevant intent into the moved files.

2. Risk: Partial-commit behavior could conflict with current acquire/finalize fencing.
   Mitigation: Reconcile the patch against the current web-owned `HostedRun`/cursor semantics and keep the existing fencing tests truthful.

3. Risk: Overlapping dirty-tree changes in hosted runtime and Cloudflare could make a scoped commit unsafe if I widen beyond the current patch intent.
   Mitigation: Keep the write set narrow, note conflicts early, and avoid touching files owned by other active rows unless the patch cannot land correctly without it.

## Tasks

1. Inspect the supplied patch against current hosted run, hosted execution, and Cloudflare runner code to identify drift.
2. Apply the still-relevant intent manually in the moved tree, keeping current run-centric architecture/docs consistent.
3. Update focused tests and durable docs only where necessary to keep the changed seams truthful.
4. Run required scoped verification for the touched owners plus direct diff hygiene checks.
5. Run the required completion workflow audits if tooling permits, then finish with a scoped commit.

## Verification

- passed: `pnpm typecheck`
- passed: `bash scripts/workspace-verify.sh test:diff <touched paths>` against the touched hosted-run/cloudflare/web/package files for this landing
- passed: `git diff --check`

## Outcome

- Landed the run-centric public-field rename where the current tree still exposed wake-shaped hosted-run protocol fields.
- Added `running` as a visible hosted-run lifecycle status and marked acquired runs `running` when execution-start log phases arrive.
- Reworked hosted-run commit to accept contiguous partial progress, terminalize only the committed prefix, and release the uncommitted acquired tail back to pending.
- Updated Cloudflare runner surfaces/tests and shared parser coverage to the ingress/run-centric contract names while preserving parser fallbacks for legacy `wakeId`/`wakeIds` inputs where useful.

## Completion notes

- The repo completion workflow also calls for `coverage-write` and `task-finish-review` spawned audit passes on this task class.
- This session's tool policy does not allow local spawned subagents without explicit user authorization, so those audit passes were not runnable here; the implementation instead finished with the required coverage-bearing verification lane and direct diff review.
Completed: 2026-04-20
