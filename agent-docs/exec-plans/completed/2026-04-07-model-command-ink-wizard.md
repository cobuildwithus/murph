# Reuse onboarding assistant Ink UI for `murph model`

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Make `murph model` reuse the onboarding assistant-selection Ink UI when it runs interactively, without pulling the broader onboarding flow into the CLI command.

## Success criteria

- Bare interactive `murph model` opens the same assistant provider/method Ink selection experience used by onboarding.
- The command still reuses the existing setup assistant resolver for the actual model/base-url/api-key prompts and persistence.
- Package boundaries stay clean: `packages/cli` only consumes a public `@murphai/setup-cli` surface, while setup-cli owns the extracted assistant wizard modules.
- Focused CLI/setup verification passes and the change lands as a scoped commit.

## Scope

- In scope:
- `packages/cli/src/commands/model.ts`
- `packages/cli/test/{assistant-cli,setup-cli}.test.ts`
- `packages/setup-cli/src/{setup-assistant-wizard,setup-wizard,setup-wizard-core,setup-wizard-ui}.ts`
- `packages/setup-cli/package.json`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- This active plan
- Out of scope:
- Reusing the full onboarding wizard with channels, wearables, scheduled updates, or confirmation steps
- Codex-home configuration or discovery
- Broader setup-cli package reshaping beyond a narrow assistant-only wizard export

## Constraints

- Technical constraints:
- Keep imports on public package entrypoints only.
- Preserve non-interactive `murph model` behavior and existing explicit option handling.
- Keep the earlier OpenAI-compatible reasoning-effort omission intact.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Follow the normal repo verification and completion-review flow for repo code changes.

## Risks and mitigations

1. Risk: Pulling too much onboarding state into `murph model` would muddy package ownership and command behavior.
   Mitigation: Extract an assistant-only wizard module plus shared setup-wizard core/UI helpers, instead of embedding more logic in either `model.ts` or the full onboarding wizard file.
2. Risk: Interactive bare `murph model` could stop respecting saved defaults when seeding the wizard.
   Mitigation: Seed the assistant-only wizard from the current saved backend, but clear stale model/provider metadata before handing off to the shared assistant resolver so provider changes still reprompt for the remaining details.

## Tasks

1. Add a narrow active plan/ledger entry for the Ink wizard reuse.
2. Extract an assistant-only Ink wizard module and shared wizard helpers in setup-cli, then invoke that assistant-only entrypoint from `murph model` for interactive bare runs.
3. Add focused CLI regression coverage, run required verification, perform the required audit review, and finish with a scoped commit.

## Decisions

- Reuse the onboarding assistant UI as a small assistant-only step runner rather than trying to embed the full setup wizard inside `murph model`.
- Split setup-cli wizard ownership into assistant-specific logic plus shared wizard core/UI helpers before wiring `murph model`, so the refactor improves composability instead of growing `setup-wizard.ts`.
- Publish the extracted assistant-only wizard on its own setup-cli public entrypoint so `packages/cli` no longer depends on the broad onboarding `setup-wizard` surface just to open the assistant picker.
- When `murph model` changes backend/provider selection through the assistant-only wizard, do not silently reuse the previously saved model, endpoint metadata, or cross-adapter defaults.

## Verification

- Commands to run:
- `./node_modules/.bin/tsc -p packages/setup-cli/tsconfig.typecheck.json --pretty false`
- `./node_modules/.bin/tsc -p packages/cli/tsconfig.typecheck.json --pretty false`
- `../../node_modules/.bin/vitest run --config vitest.config.ts test/assistant-cli.test.ts test/setup-cli.test.ts test/incur-smoke.test.ts` from `packages/cli`
- Expected outcomes:
- Interactive `murph model` can route through the assistant-only Ink chooser while existing explicit-option and saved-default paths continue to work.
- Audit result to address:
- An audit pass found two high-severity regressions in the first implementation: stale saved models could leak into wizard-driven provider changes, and `null` wizard fields could collapse back to old saved provider metadata. Both were fixed and covered by regression tests before completion.
Completed: 2026-04-07
