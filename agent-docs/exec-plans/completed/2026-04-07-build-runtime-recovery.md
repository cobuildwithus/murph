# Recover workspace build and prepared CLI runtime

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Restore a buildable local workspace state for the currently failing packages so the prepared CLI runtime can be rebuilt and the local assistant can invoke `vault-cli` commands without crashing during module resolution.

## Success criteria

- `pnpm build:test-runtime:prepared` completes successfully.
- `pnpm typecheck` completes successfully.
- Direct CLI startup works through the installed shim, built entrypoint, and source entrypoint.
- The fix stays scoped to the current type/runtime regressions and preserves unrelated hosted work already in the tree.

## Scope

- In scope:
- Current TypeScript failures in `packages/core`, `packages/hosted-execution`, `packages/assistant-engine`, and `packages/device-syncd` that block workspace build/typecheck.
- Root workspace build-script metadata that leaves stale incremental build state behind after the clean step.
- Prepared CLI runtime recovery and direct startup verification for `vault-cli`.
- Out of scope:
- Unrelated hosted feature work already in progress in `apps/web` and `apps/cloudflare`.
- Broader refactors or cleanup outside the failing build surface.

## Constraints

- Technical constraints:
- Preserve unrelated dirty worktree edits and overlapping active lanes.
- Keep fixes minimal and aligned with existing contracts instead of papering over errors with broad casts.
- Keep the workspace build fix narrowly scoped to the stale incremental metadata issue rather than rewriting unrelated build scripts.
- Product/process constraints:
- Follow repo completion workflow, including required verification and plan closure before commit.

## Risks and mitigations

1. Risk: Overwriting or destabilizing unrelated hosted work while fixing shared types.
   Mitigation: Touch only the current failing files and re-read overlapping files immediately before edits.
2. Risk: Fixing local startup temporarily while leaving the prepared build path red.
   Mitigation: Treat `build:test-runtime:prepared` and `pnpm typecheck` as required completion checks, plus direct CLI scenario proof.

## Tasks

1. Inspect each current TypeScript failure and identify the minimal contract-safe fix.
2. Implement focused fixes in `core`, `hosted-execution`, and `assistant-engine`.
3. Re-run `pnpm build:test-runtime:prepared` until the prepared runtime is green.
4. Re-run `pnpm typecheck` and direct CLI startup checks.
5. Complete final review, close the plan, and commit only the touched paths.

## Decisions

- Start from the current compiler errors rather than rebuilding broad packages blindly, because the worktree already contains unrelated hosted edits and the failing surfaces are small enough to inspect directly.

## Verification

- Commands to run:
- `pnpm build:test-runtime:prepared`
- `pnpm typecheck`
- `vault-cli --help`
- `node packages/cli/dist/bin.js --help`
- `pnpm exec tsx packages/cli/src/bin.ts --help`
- Expected outcomes:
- Prepared runtime rebuild succeeds, workspace typecheck succeeds, and all three CLI entrypaths print help without module-load errors.
Completed: 2026-04-07
