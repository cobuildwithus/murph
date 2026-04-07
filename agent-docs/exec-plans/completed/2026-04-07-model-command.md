# Add root model command for assistant backend selection

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Add a top-level `murph model` command that lets operators inspect and update the saved default assistant backend without re-running onboarding or opening chat first.

## Success criteria

- `murph model show` returns the saved backend state from operator config.
- `murph model` can update the saved backend through the existing setup assistant-selection logic instead of duplicating provider/model prompts.
- The new root command is registered cleanly in the CLI manifest and typed Inc ur surface.
- Focused CLI tests cover at least one read path and one update path.

## Scope

- In scope:
- Root CLI command surface for `model` and `model show`
- Reuse of existing setup assistant resolver and existing assistant-default persistence seam
- Focused CLI tests and regenerated command types/schema artifacts
- Out of scope:
- Codex-home discovery, persistence, or onboarding changes
- Broader assistant/onboarding UX redesign

## Constraints

- Technical constraints:
- Keep the assistant backend owner in operator config; do not introduce a second config source.
- Minimize duplicated provider/model prompt logic by reusing existing setup helpers.
- Product/process constraints:
- Keep the command simple and operator-facing; defer Codex-home design to follow-up work.

## Risks and mitigations

1. Risk: Root command registration can drift from default-vault coverage assumptions.
   Mitigation: Update manifest/test coverage together and keep `model` explicitly outside vault-required paths.
2. Risk: Reusing onboarding helpers could pull in more state than the command should own.
   Mitigation: Limit reuse to assistant-selection and persistence helpers only.

## Tasks

1. Add a root `model` command module and register it in the CLI manifest.
2. Reuse setup assistant-selection logic plus shared assistant-default persistence helpers.
3. Regenerate typed CLI artifacts and config schema.
4. Add focused CLI tests for `model show` and interactive/default-update flows.

## Decisions

- Reuse the existing setup assistant-selection seam rather than building a new provider/model picker.
- Keep Codex-home work out of this change set.

## Verification

- Commands to run:
- `pnpm verify:cli`
- `pnpm --dir packages/cli exec vitest run test/assistant-cli.test.ts`
- Expected outcomes:
- New `model` command paths pass focused CLI verification and generated-surface checks.
Completed: 2026-04-07
