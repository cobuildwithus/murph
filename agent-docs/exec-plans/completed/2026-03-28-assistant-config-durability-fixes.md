# Assistant Config Durability Fixes

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

- Fix the remaining assistant config durability bugs in `packages/cli` so legacy operator config and session records migrate safely, OpenAI-compatible defaults persist the full runnable config, and failover/discovery identity uses normalized execution state instead of cosmetic labels.

## Success criteria

- Legacy flat assistant operator defaults survive normalization and unrelated writes without losing the selected provider's saved settings.
- Legacy session records carrying `codexPromptVersion` migrate that value into `providerState.codexCli.promptVersion`.
- `/model` persists full sanitized provider defaults for the current provider, including OpenAI-compatible endpoint/auth/header settings.
- Failover route dedupe/cooldown identity hashes only normalized execution identity, while labels stay human-readable and distinguish OpenAI-compatible endpoints.
- Discovery and execution use the same env/header normalization rules, including merged env lookup, trimmed API keys, and case-insensitive header dedupe.
- Setup consumes provider discovery status instead of collapsing to raw string arrays, rejects or ignores unsupported OpenAI-compatible reasoning effort early, and keeps the model switcher aligned with the currently highlighted model's capabilities.
- Focused tests cover the regressions above.

## Scope

- In scope:
- `packages/cli` assistant config, persistence, setup, failover, and Ink chat files listed in the ledger row
- focused `packages/cli` regression tests
- Out of scope:
- unrelated assistant runtime/UI features
- broad CLI cleanup outside the affected config surfaces

## Constraints

- Preserve unrelated dirty worktree edits.
- Keep `defaultsByProvider` as the durable source of truth and only preserve flat-field compatibility where existing schema/write paths still require it this turn.
- Run required verification plus mandatory `simplify`, `test-coverage-audit`, and `task-finish-review` subagent passes before handoff.

## Risks and mitigations

1. Risk: legacy flat config still gets dropped during a later patch path.
   Mitigation: centralize provider-default materialization behind one helper used by all normalization/build/read paths.
2. Risk: OpenAI-compatible defaults become unrunnable after `/model` or setup because auth/endpoint fields are omitted.
   Mitigation: persist sanitized provider-scoped defaults from the live session/setup result instead of a partial projection.
3. Risk: failover dedupe/cooldown fragments because route ids still depend on labels or unsanitized option storage.
   Mitigation: hash only sanitized provider config plus codex command and reuse provider label helpers strictly for UI/logging.

## Verification plan

- Focused package tests while iterating:
- `pnpm vitest packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-robustness.test.ts packages/cli/test/assistant-runtime.test.ts`
- Required repo commands before handoff:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Direct scenario proof:
- confirm `/model` persistence and legacy migration behavior through focused runtime/persistence tests
Completed: 2026-03-28
