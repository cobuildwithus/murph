# Health command factory simplify

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Reduce the internal complexity of `packages/cli/src/commands/health-command-factory.ts` while preserving the existing CLI command surface.

## Success criteria

- Replace the repeated factory branches with a smaller set of typed helpers for the real shared patterns.
- Remove the local `any`-style escape hatches where generic inference can carry the types instead.
- Keep command names, arg/option wiring, outputs, examples, hints, and CTAs unchanged for all existing callers.
- Keep downstream command modules simple; only touch them when stronger typing or helper boundaries require it.

## Scope

- In scope:
- internal refactor of `health-command-factory.ts`
- lightweight downstream typing adjustments in existing CLI command modules
- test updates only if current coverage needs to assert preserved behavior more directly
- Out of scope:
- new CLI commands or command-surface redesign
- changing documented examples, hints, or output shapes

## Constraints

- Preserve built CLI behavior and avoid churn outside the affected command-registration helpers.
- Respect the active assistant/runtime lane in `packages/cli`.
- Follow the completion workflow and required repo verification commands.

## Risks and mitigations

1. Risk: helper consolidation could subtly change option parsing or command metadata.
   Mitigation: keep the existing command builders as the behavioral source of truth while extracting wrappers one pattern at a time.
2. Risk: tighter typing could force broader downstream edits than intended.
   Mitigation: push inference from config objects first and only annotate call sites where the compiler genuinely needs help.
3. Risk: internal refactors can break built CLI tests even when the source looks equivalent.
   Mitigation: run the required repo checks and keep runtime-focused command suites as the acceptance signal.

## Tasks

1. Identify the minimal typed helper set for named-id commands, stdin/file upserts, list option extraction, and shared CTAs.
2. Refactor `health-command-factory.ts` around those helpers and delete or thin factory layers that no longer pay for themselves.
3. Adjust downstream command configs only where the new helper boundaries require it.
4. Run simplify/coverage/final audit passes, rerun required verification, and commit the scoped files.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Focused checks: targeted `packages/cli` tests during implementation if the refactor needs faster feedback
Completed: 2026-03-17
