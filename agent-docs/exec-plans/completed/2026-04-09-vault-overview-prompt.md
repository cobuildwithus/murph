# Vault overview prompt injection

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Add a small navigation-only assistant prompt block that summarizes high-signal vault coverage so fresh turns can orient more quickly without treating that summary as canonical evidence.

## Success criteria

- Assistant turns receive a concise vault overview block when enough overview data is available.
- The injected text explicitly distinguishes canonical records from raw import evidence and other broad source-presence hints.
- The overview is framed as navigation/orientation only and tells the model to query the vault before making factual claims.
- Existing prompt architecture remains behavior-first; this change does not recreate assistant-memory-style prompt stuffing.
- Focused tests cover the new prompt content and any new overview-building helper behavior.

## Scope

- `packages/assistant-engine/**`
- small supporting query/helper updates only if needed for overview assembly
- focused tests in the affected owner packages

## Constraints

- Preserve unrelated worktree edits.
- Keep the change narrow; avoid introducing a broad prompt-time retrieval subsystem.
- Do not blur canonical records, raw manifests, and derived/runtime residue in the injected wording.
- Follow the repo-required verification path for `packages/assistant-engine` changes.

## Plan

1. Inspect existing prompt assembly and query/read helpers for the narrowest place to compute a vault overview.
2. Implement one compact overview seam that reports navigation-oriented counts/presence with explicit caveats.
3. Add focused tests for overview assembly and prompt inclusion.
4. Run required verification and a direct scenario-style proof of the injected prompt content.
5. Run the required final audit pass, address findings, and land a scoped commit.

## Outcome

- Added `packages/assistant-engine/src/assistant/vault-overview.ts` as the narrow bootstrap-only overview builder.
- Wired bootstrap prompt assembly to inject that block only on fresh provider turns without native resume.
- Kept the overview explicitly navigation-only and subordinate to `profile show current` plus wiki/knowledge reads.
- Added focused tests for overview content, empty-vault omission, bootstrap injection, resumed-turn omission, and overview-helper failure fallback.

## Verification

- Passed: `pnpm --dir packages/assistant-engine exec vitest run test/assistant-vault-overview.test.ts test/provider-turn-runner.test.ts --no-coverage`
- Passed: `pnpm --dir packages/assistant-engine typecheck`
- Passed: `pnpm --dir packages/assistant-engine test`
- Passed: `pnpm typecheck`
- Passed direct scenario proof: `pnpm exec tsx --eval '<async temp-vault overview proof>'`
  - Printed the expected navigation-only overview block with canonical, raw, bank, and source-root distinctions.

## Audit

- Required `task-finish-review` audit completed.
- Addressed audit findings by:
  - omitting the overview entirely when no positive signals exist
  - replacing recursive inbox walks with cheap root-presence checks
  - adding a failure-path test that proves overview generation cannot block a bootstrap turn
Completed: 2026-04-09
