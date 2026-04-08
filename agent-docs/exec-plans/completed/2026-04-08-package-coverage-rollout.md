# Package coverage rollout for tested packages without package-wide coverage gates

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Expand the root coverage lane so it enforces package-wide coverage for the requested packages using clean include patterns rather than fragile hand-maintained file lists.
- Use one Codex worker per target package to plan and implement package-local coverage improvements while reusing existing shared harnesses and helpers wherever possible.

## Success criteria

- Root `pnpm test:coverage` includes package-wide coverage for:
  - `@murphai/assistant-engine`
  - `@murphai/assistant-runtime`
  - `@murphai/assistantd`
  - `@murphai/murph`
  - `@murphai/contracts`
  - `@murphai/device-syncd`
  - `@murphai/inboxd`
  - `@murphai/messaging-ingress`
  - `@murphai/openclaw-plugin`
- Root coverage configuration uses package-level include patterns instead of a curated file list for those packages.
- Package workers add or extend tests with shared helpers and harnesses instead of cloning setup logic across files.
- Required verification passes for the resulting repo change, or any unrelated blockers are documented precisely.

## Scope

- In scope:
  - Root Vitest coverage wiring for the listed packages
  - Package-local `vitest.config.ts` coverage configuration as needed
  - Package-local tests and reusable test helpers/harness setup
  - Worker prompt artifacts for the package fanout
- Out of scope:
  - Unrelated package refactors
  - Broad architecture or product-behavior changes
  - Coverage expansion for packages outside the requested list unless required by shared harness extraction inside one of the target packages

## Constraints

- Technical constraints:
  - Preserve unrelated worktree edits.
  - Avoid parallel edits to shared root coverage files from multiple package workers.
  - Prefer shared helpers and existing harness patterns over package-specific duplication.
  - Keep package workers scoped to one package plus prompt artifacts; central integration owns root config merges.
- Product/process constraints:
  - Follow repo workflow, verification, and commit rules from `AGENTS.md` and `agent-docs/**`.
  - Use one Codex worker per requested package.
  - Package workers may spawn GPT-5.4 high subagents for disjoint seams inside their package.

## Risks and mitigations

1. Risk: Parallel workers collide on root coverage wiring or shared helper files.
   Mitigation: Keep shared root/config integration centralized and instruct package workers to treat shared-file edits as opt-in only when explicitly owned.
2. Risk: Coverage thresholds are set before packages have realistic tests, causing churn.
   Mitigation: Require each package worker to inventory current gaps first and implement missing tests before tightening gates.
3. Risk: Large packages, especially `assistant-engine`, sprawl into low-value or duplicate tests.
   Mitigation: Require package workers to group work into seams, reuse existing helpers, and prioritize high-leverage behavioral tests over mechanical line-chasing.

## Tasks

1. Capture current coverage/test topology for the requested packages and confirm worker ownership boundaries.
2. Generate one prompt file per requested package with package-local scope plus shared-harness guidance.
3. Launch one Codex worker per package in the current worktree via the installed `codex-workers` helper.
4. Review worker plans and ongoing implementation for overlap, root-config needs, and shared helper opportunities.
5. Integrate root coverage expansion and any necessary shared harness setup centrally.
6. Run required verification and finalize with the repo completion workflow.

## Decisions

- Use one Codex worker per requested package for both planning and implementation.
- Keep root coverage integration centralized so the root config stays package-based and conflict-free.
- Prefer package-wide include patterns for the requested packages instead of curated file lists for those packages.
- Keep the root multi-project Vitest lane as the package smoke/orchestration runner, but enforce the rollout-package coverage gates through standalone package coverage commands because Vitest root project mode does not reliably fail child coverage thresholds.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:coverage`
  - Focused package-local test commands as needed during iteration
- Expected outcomes:
  - The rollout packages have passing standalone package coverage commands with package-wide patterns or documented rollout thresholds.
  - The root multi-project Vitest lane stays green as the package smoke/orchestration runner for the same package set.
Completed: 2026-04-08
