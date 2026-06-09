# Propagate useful assistant CLI hints

Status: completed
Created: 2026-06-08
Updated: 2026-06-08

## Goal

- Make assistant compact CLI discovery carry useful command hints without adding a separate command whitelist.
- Fix `supplement save` discovery so agents see the JSON-object `--ingredient` shape before attempting writes.

## Success criteria

- Global/full CLI discovery preserves command hints for commands that define them.
- Assistant compact CLI rendering includes non-empty command hints generically, with existing truncation behavior.
- `supplement save` has a shape-useful hint for repeated JSON-object ingredients.
- Focused tests cover hint propagation and rendering.

## Scope

- In scope: `packages/cli` manifest/discovery output, `packages/assistant-engine` compact CLI rendering, focused tests, generated assistant CLI surface artifact if required by the build path.
- Out of scope: new command-family whitelists, broader CLI schema redesign, adding `supplement import-json`, or changing supplement save runtime validation.

## Constraints

- Technical constraints: keep incur command topology truthful; do not duplicate command importance in assistant-specific lists; preserve compact CLI budget.
- Product/process constraints: keep the change small, composable, and local to existing command metadata.

## Risks and mitigations

1. Risk: rendering every hint adds noisy prompt text.
   Mitigation: only commands with explicit source hints opt in, keep existing truncation, and improve any newly exposed hint that is not useful enough.
2. Risk: descriptor-level hints and incur command hints drift.
   Mitigation: preserve command-defined hints in the same full manifest path already used for descriptions and schemas.

## Tasks

1. Done: Inspect full manifest, compact renderer, and existing hint sources.
2. Done: Implement generic command hint propagation/rendering.
3. Done: Update `supplement save` hint.
4. Done: Add focused regression coverage.
5. Done: Run scoped verification and completion review workflow.

## Decisions

- Treat `hint` itself as the opt-in importance signal; do not add a separate important-write-command whitelist.

## Verification

- Commands to run: `pnpm typecheck`; `pnpm test:diff packages/cli/src/vault-cli-llms-normalizer.ts packages/cli/src/commands/supplement.ts packages/assistant-engine/src/assistant/cli-surface-bootstrap.ts`.
- Expected outcomes: typecheck and focused diff-aware tests pass, and direct CLI output shows `supplement save` hint in compact assistant contract.
- Evidence:
  - Focused Vitest run for `assistant-cli-surface-bootstrap`, `incur-smoke`, and `supplement-save-typed-parity` passed.
  - Direct source CLI compact/full JSON manifests show the new `supplement save` hint.
  - Direct assistant compact-contract check renders `supplement save` with both `repeat --ingredient=string` and the JSON-object hint while staying under 40,000 chars.
  - `pnpm typecheck` passed.
  - `pnpm test:diff packages/cli/src/vault-cli-llms-normalizer.ts packages/cli/src/commands/supplement.ts packages/cli/src/commands/capture.ts packages/cli/src/vault-cli-command-manifest.ts packages/assistant-engine/src/assistant/cli-surface-bootstrap.ts packages/assistant-engine/test/assistant-cli-surface-bootstrap.test.ts packages/cli/test/incur-smoke.test.ts packages/cli/test/supplement-save-typed-parity.test.ts` passed.
  - Required audit subagent could not run because the subagent returned a usage-limit error; local coverage/final review found no additional changes needed.
Completed: 2026-06-08
