# Remove packages/local-web and related repo wiring

Status: completed
Created: 2026-04-02
Updated: 2026-04-02

## Goal

- Remove the private `packages/local-web` Next.js app from the workspace and leave the repo in a consistent state with no live build, test, script, or durable-doc references that assume the package still exists.

## Success criteria

- `packages/local-web/**` is deleted from the working tree.
- Root scripts, verification lanes, and tracked-artifact guards no longer reference `packages/local-web`.
- Durable repo docs describe only the remaining local and hosted runtime surfaces.
- Required verification for this change passes, or any failure is demonstrated to be unrelated pre-existing breakage.

## Scope

- In scope:
  - Delete `packages/local-web/**`.
  - Remove root `package.json`, verification, test, and hygiene wiring for the deleted package.
  - Update durable docs that currently describe `packages/local-web` as a supported surface.
- Out of scope:
  - Replacing the removed package with a new UI surface.
  - Rewriting historical completed execution plans that mention `packages/local-web`.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty worktree edits.
  - Keep root verification scripts truthful after the package removal.
- Product/process constraints:
  - Follow the repo completion workflow, including the required final review audit.
  - Update durable docs and index entries when docs are removed or materially repurposed.

## Risks and mitigations

1. Risk: Root verification or hygiene scripts still reference deleted `packages/local-web` paths and fail after the directory is removed.
   Mitigation: Sweep `package.json`, `scripts/**`, `vitest.config.ts`, and durable verification docs before final verification.
2. Risk: Durable repo docs drift and continue documenting a removed surface.
   Mitigation: Update `AGENTS.md`, `ARCHITECTURE.md`, `README.md`, `docs/architecture.md`, `agent-docs/index.md`, and verification/testing docs in the same change.

## Tasks

1. Remove `packages/local-web/**`.
2. Remove root/workspace script, config, and test references to the deleted package.
3. Update durable docs and routing to reflect the smaller runtime surface.
4. Run required verification, complete the audit workflow, and commit the scoped diff.

## Decisions

- Remove the entire `packages/local-web` surface rather than leaving a stub package behind, so verification and docs match the actual product surface.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Root verification completes without any remaining dependency on `packages/local-web`.

## Outcomes

- Deleted `packages/local-web/**` and removed root scripts, verification hooks, tracked-artifact guards, workspace source-resolution helpers, durable docs, and focused test/config references that assumed the package still existed.
- Removed durable-doc and fixture wording that still presented a live local-web or observability surface.

## Verification results

- `corepack pnpm install --lockfile-only --ignore-scripts`: passed
- `bash scripts/doc-gardening.sh`: passed
- `bash scripts/check-agent-docs-drift.sh`: passed
- `git diff --check -- [scoped paths]`: passed
- `pnpm typecheck`: failed in unrelated pre-existing assistant-memory files under `packages/assistant-core/src/assistant-cli-tools.ts` and `packages/assistant-core/src/assistant/provider-turn-runner.ts`
- `pnpm test`: failed in unrelated pre-existing assistant-core / CLI lanes after the same assistant-memory breakage
- `pnpm test:coverage`: failed early for the same unrelated assistant-core breakage

## Audit

- Final `task-finish-review` audit found remaining local-web references in `ARCHITECTURE.md`, fixture docs, fixture metadata, and stale `.gitignore` entries.
- Those references were removed or rewritten so only the active execution-plan artifacts mention `packages/local-web`.
Completed: 2026-04-02
