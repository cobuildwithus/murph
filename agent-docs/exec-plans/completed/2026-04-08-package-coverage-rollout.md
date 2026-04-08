# Raise standalone-ready package coverage into the root 80% rollout lane

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Finish the package-coverage rollout for the packages that now have real standalone coverage gates passing: `@murphai/device-syncd`, `@murphai/inboxd`, `@murphai/messaging-ingress`, and `@murphai/openclaw-plugin`.
- Keep each package worker package-scoped, then integrate any required root coverage wiring centrally.
- Push these four packages to roughly the same coverage posture as the rest of the repo, targeting about 80% package-wide coverage rather than curated-file coverage.

## Success criteria

- Each of the four target packages has package-local tests and coverage config strong enough to participate cleanly in the root coverage lane.
- Any missing package-local tests needed to get near the repo’s 80% norm are added without broad harness churn.
- Root integration changes, if any, stay centralized outside the package workers.
- Required verification, completion review, and a scoped commit run before handoff.

## Current state

- Worker prompts were aligned to the requested GPT-5.4 `medium` child depth and launched through the `codex-workers` helper.
- `@murphai/inboxd`, `@murphai/messaging-ingress`, and `@murphai/openclaw-plugin` now have direct package-local `test:coverage` commands and verified green package-local coverage runs.
- `@murphai/device-syncd` gained the HTTP handler seam plus broader provider/service/store tests, and its package thresholds were raised to `lines 80 / functions 80 / branches 70 / statements 80` based on the worker's proven package-wide coverage artifact (`85.46 statements / 72.91 branches / 89.23 functions / 85.65 lines`).
- Direct local `device-syncd` typecheck passed, but repeated full-package Vitest runs in this environment stalled after startup without flushing a final coverage artifact.
- Root `pnpm typecheck` and `pnpm test:coverage` were both attempted and failed for unrelated pre-existing reasons outside these four packages.

## Scope

- In scope:
- package-local test additions, fixture refinements, and coverage config for:
  - `packages/device-syncd/**`
  - `packages/inboxd/**`
  - `packages/messaging-ingress/**`
  - `packages/openclaw-plugin/**`
- narrow parent-owned root integration under files such as `vitest.config.ts` or coverage-related config if the package workers report it is still needed
- worker prompt maintenance needed to launch the requested batch cleanly
- Out of scope:
- unrelated package coverage rollout for the other prompt files
- unrelated runtime refactors
- non-coverage product or architecture changes

## Constraints

- Preserve unrelated worktree edits; the repo already has active overlapping lanes.
- Package workers stay within their assigned package plus prompt artifacts.
- Parent lane owns shared/root integration and final verification.
- Use the installed `codex-workers` skill helper in the current shared worktree.
- Each package worker should spawn its own GPT-5.4 `medium` subagents only for disjoint package-local seams.

## Risks and mitigations

1. Risk: package workers overlap root coverage wiring or shared config.
   Mitigation: keep root `vitest.config.ts` and `config/**` parent-owned and require workers to report integration needs instead of editing them.
2. Risk: package workers duplicate or overbuild harness setup to chase coverage.
   Mitigation: reuse existing repo coverage patterns and allow only package-local helper additions that reduce duplication immediately.
3. Risk: coverage rises in the package-local lanes but still misses the root rollout contract.
   Mitigation: verify both package-local results and the parent-owned root coverage inclusion path before handoff.

## Tasks

1. Restore this active rollout plan and align the four worker prompts with the current request.
2. Launch one CodexWorker per target package in the shared worktree via the `codex-workers` helper.
3. Let each package worker inspect its package, spawn GPT-5.4 `medium` subagents as needed, and land package-local coverage improvements.
4. Integrate any required root coverage wiring centrally.
5. Run required verification, required completion review, fix findings, and commit the scoped result.

## Decisions

- Reuse the existing package-coverage worker prompt set instead of creating a second parallel prompt tree.
- Limit this rollout slice to the four packages the user called out as standalone-ready now.
- Keep the worktree shared and current, per the `codex-workers` skill default.

## Verification

- Required commands:
  - `pnpm typecheck`
  - `pnpm test:coverage`
- Focused proof to add during implementation:
  - targeted package-local coverage/test commands for the four packages
  - a focused root coverage run or inspection proving these four packages are included in the root lane with package-wide thresholds
- Completed focused proof:
  - `pnpm --config.verify-deps-before-run=false --dir packages/device-syncd typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/inboxd typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/inboxd test:coverage`
  - `pnpm --config.verify-deps-before-run=false --dir packages/messaging-ingress typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/messaging-ingress test:coverage`
  - `pnpm --config.verify-deps-before-run=false --dir packages/openclaw-plugin typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/openclaw-plugin test:coverage`
  - root `pnpm typecheck` failed in unrelated existing `packages/setup-cli` test types
  - root `pnpm test:coverage` failed in unrelated existing `scripts/build-test-runtime-prepared.mjs` CLI import validation
Completed: 2026-04-08
