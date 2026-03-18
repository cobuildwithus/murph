# Assistant Ink paste follow-up

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Remove the remaining terminal-specific composer corruption when large text blocks are pasted or dictated into `healthybob chat`.

## Success criteria

- Large pasted text stays visually stable in the live Ink composer in the `healthybob chat` binary.
- The composer render path is simpler and less terminal-fragile than the current styled per-character cursor flow.
- Focused assistant runtime coverage still exercises paste normalization and the updated composer display behavior.
- Required repo checks are attempted again and outcomes are recorded truthfully.

## Scope

- In scope:
- `packages/cli/src/assistant/ui/ink.ts`
- `packages/cli/src/assistant-chat-ink.ts`
- `packages/cli/test/assistant-runtime.test.ts`
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- unrelated assistant provider/session behavior
- broader chat transcript/footer styling
- unrelated dirty worktree state

## Constraints

- Preserve overlapping assistant-lane edits already in flight.
- Favor terminal robustness over cursor cosmetics if the two conflict.
- Do not revert or clean up unrelated worktree changes.

## Risks and mitigations

1. Risk: simplifying the cursor display could regress some editor affordances.
   Mitigation: keep input editing behavior intact and constrain the change to display output only where possible.
2. Risk: local PTY reproduction may still differ from the user’s terminal integration.
   Mitigation: validate against the exact `healthybob chat` binary path and favor simpler terminal output over richer styling.
3. Risk: repo-wide red checks outside this lane remain noisy.
   Mitigation: rerun focused assistant verification first, then the required repo checks, and separate unrelated failures clearly.

## Tasks

1. Simplify the live composer display/cursor rendering for terminal robustness.
2. Keep paste normalization and directly affected tests aligned with the new display logic.
3. Reproduce against the built `healthybob chat` path and rerun verification.
4. Commit only the scoped files if unrelated repo failures remain outside this lane.

## Decisions

- The follow-up will optimize for stable terminal rendering even if that means a less decorative cursor treatment.
- Reproduction should use the built `healthybob` wrapper, not just source-only `pnpm chat`.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
- `pnpm exec tsc -p packages/cli/tsconfig.typecheck.json --pretty false --noEmit`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- focused assistant verification passes
- repo-wide checks may still fail only for unrelated existing `contracts` / `web` issues outside the touched assistant composer files
Completed: 2026-03-18
