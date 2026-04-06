# Assistant capability host bindings refactor

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Let assistant capability-definition helpers carry more than one execution binding so the capability-registry/host design is real in the helper layer, not just in the raw registry primitives.

## Success criteria

- `assistant-cli-tools/capability-definitions.ts` no longer forces every helper-defined capability into a single binding.
- Existing helper call sites continue to work unchanged with the current single-`execute` shorthand.
- Focused tests prove a helper-defined capability can expose both `cli-backed` and `native-local` bindings and that host selection/fallback behaves correctly.

## Scope

- In scope:
- Refactor the helper input shape in `assistant-cli-tools/capability-definitions.ts`.
- Add focused tests for helper-defined multi-host capability bindings.
- Out of scope:
- Converting existing production capabilities to multi-host definitions when they do not need alternate bindings yet.
- Changing externally visible tool names or capability metadata beyond the new binding support.

## Constraints

- Technical constraints:
- Preserve current helper ergonomics for existing callers.
- Keep provenance and preferred-execution defaults aligned with the wrapper that defines the capability.
- Product/process constraints:
- Follow the repo completion workflow for this repo code change, including focused verification and final review.

## Risks and mitigations

1. Risk: The helper refactor could accidentally change preferred host selection for existing capabilities.
   Mitigation: Preserve wrapper-specific default preferred modes and keep current call sites on the single-`execute` shorthand.
2. Risk: The new API could overfit to tests and make future helper call sites awkward.
   Mitigation: Support both the existing shorthand and explicit `executionBindings` in one small generic helper shape.

## Tasks

1. Refactor the capability-definition helper types to accept either a single default executor or an explicit `executionBindings` map. Done.
2. Add focused coverage that defines one capability through the helper layer with both CLI-backed and native-local bindings. Done.
3. Run the relevant typecheck/tests, then complete the repo audit/commit flow. In progress.

## Decisions

- Keep existing wrappers and provenance helpers; broaden only the shared execution-binding input contract.
- Preserve single-`execute` shorthand for today’s call sites instead of forcing a bulk migration to explicit binding maps.
- Prove the refactor through the shared helper directly in `packages/assistant-core/test` so the test isolates execution-binding behavior from wrapper-specific provenance inference.

## Verification

- Commands to run:
- `pnpm --dir packages/assistant-core typecheck`
- `pnpm --dir packages/assistant-core test`
- Expected outcomes:
- Typecheck passes.
- Package tests pass, including the new focused multi-host helper coverage.

## Progress notes

- `packages/assistant-core/src/assistant-cli-tools/capability-definitions.ts` now accepts either a single `execute` shorthand or explicit `executionBindings`, while preserving the wrapper default execution mode.
- Added `packages/assistant-core/test/capability-definition-host-bindings.test.ts` to prove one helper-defined capability can bind to both CLI-backed and native-local hosts and fall back correctly.
- `pnpm --dir packages/assistant-core typecheck` passed.
- `pnpm --dir packages/assistant-core test` passed.
- The worktree contains unrelated pre-existing edits in `packages/assistant-core/src/model-harness.ts`, `packages/cli/test/assistant-harness.test.ts`, `apps/web/next-env.d.ts`, and another active plan file; this task should commit only its own touched paths plus the closed plan artifact.
Completed: 2026-04-06
