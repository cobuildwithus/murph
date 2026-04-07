# Simplify the root model command implementation

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Reduce local duplication in the root `murph model` command with a behavior-preserving local formatter seam, while keeping the earlier OpenAI-compatible reasoning-effort fix intact.

## Success criteria

- `packages/cli/src/commands/model.ts` replaces its duplicated assistant summary formatting branches with one shared local formatter.
- The command keeps its intentional behavior difference for OpenAI-compatible reasoning-effort reuse.
- Focused CLI/setup verification still passes and the change lands as a scoped follow-up commit.

## Scope

- In scope:
- `packages/cli/src/commands/model.ts`
- `packages/cli/test/assistant-cli.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- This active plan
- Out of scope:
- New Codex-home configuration flows
- Reworking onboarding or operator-config ownership seams
- Broad command-surface redesign beyond the existing `model` command

## Constraints

- Technical constraints:
- Keep imports on declared public entrypoints only.
- Preserve the current `model` command behavior, including not seeding OpenAI-compatible reasoning effort back into the setup resolver defaults.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Follow the normal repo verification and completion-review flow for repo code changes.

## Risks and mitigations

1. Risk: Re-exporting the setup helper seam could accidentally broaden package coupling or create typecheck fallout.
   Mitigation: Avoid cross-package helper reuse in this follow-up and keep the cleanup local to the CLI command.
2. Risk: Reusing the shared helper wholesale could reintroduce the stale reasoning-effort bug for OpenAI-compatible backends.
   Mitigation: Keep `buildSetupAssistantOptionsFromDefaults()` local in `model.ts` and reuse only the helpers whose behavior matches exactly.

## Tasks

1. Add a fresh active plan/ledger reference for this follow-up cleanup.
2. Replace the duplicated summary-formatting branches in `model.ts` with one local formatter and keep the reasoning-effort behavior unchanged.
3. Add focused regression coverage for the formatter branches, run required verification, perform the required audit review, and finish with a scoped commit.

## Decisions

- Keep this cleanup local to `model.ts` instead of changing setup-cli package exports in a follow-up whose goal is only simplification.

## Verification

- Commands to run:
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/setup-cli typecheck`
- `pnpm --dir packages/cli exec vitest run test/assistant-cli.test.ts`
- `pnpm --dir packages/cli exec vitest run test/incur-smoke.test.ts`
- Expected outcomes:
- The root `model` command still shows and saves assistant defaults correctly, and the CLI/setup packages typecheck with the shared helper seam exposed publicly.
Completed: 2026-04-07
