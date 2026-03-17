# Simplify health CLI descriptor registry entries

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Remove obvious copy/paste duplication from the registry-style health CLI descriptor entries while preserving every surfaced command string, method binding, helper/tool description, and read/write routing behavior.

## Success criteria

- `goal`, `condition`, `allergy`, `regimen`, `family`, and `genetics` are rebuilt through one small local helper in `packages/cli/src/health-cli-descriptors.ts`.
- `assessment`, `profile`, and `history` remain hand-authored and behaviorally unchanged.
- Downstream consumers still receive identical descriptor-driven metadata and wiring.
- The targeted CLI descriptor/metadata tests pass, followed by the required repo verification commands.

## Scope

- In scope:
- one local helper for the shared status-filtered registry descriptor shape
- refactoring only the six registry-style descriptor entries named in the task
- targeted tests and any minimal downstream descriptor-alignment edits required by the refactor
- Out of scope:
- changing command behavior, help text wording, assistant tool names, examples, or capability bundles
- introducing a second descriptor system, derivation heuristics, or irregular noun logic
- refactoring `assessment`, `profile`, or `history`

## Constraints

- Technical constraints:
- preserve all existing method names, result id fields, result capabilities, examples, hints, and filter capabilities
- keep the helper local to `health-cli-descriptors.ts` and typed against existing descriptor method-name unions
- Product/process constraints:
- keep the coordination ledger current for this lane and preserve unrelated in-progress CLI edits
- run the repository completion workflow plus the required verification commands before handoff

## Risks and mitigations

1. Risk: A helper that over-generalizes could silently change command descriptions or capability wiring.
   Mitigation: Pass explicit strings and method names for every varying field and leave irregular entities hand-authored.
2. Risk: Descriptor metadata drift can surface indirectly through command help, schema manifests, or assistant tools.
   Mitigation: Run the targeted descriptor/metadata tests first, then the required repo verification commands.

## Tasks

1. Add the ledger row and keep this plan current while the lane is active.
2. Implement the small local descriptor helper and rebuild only the six duplicated registry entries with it.
3. Run the targeted CLI tests covering descriptor wiring, help/schema metadata, and stdin payload flows.
4. Run required repo verification, complete the simplify/coverage/final-review audit sequence, then remove the ledger row and close the plan.

## Decisions

- Use explicit helper inputs for every user-visible string and every method-name binding instead of deriving nouns, plurals, or service names.
- Keep downstream files read-only unless the refactor reveals a concrete alignment break.
- No follow-up tests were added because the existing descriptor wiring and surfaced-metadata coverage already exercises the affected paths directly.

## Verification

- Commands to run:
- `pnpm --filter @healthybob/cli exec vitest run packages/cli/test/health-tail.test.ts -t "goal descriptor wiring keeps noun-specific and generic reads aligned"`
- `pnpm --filter @healthybob/cli exec vitest run packages/cli/test/health-tail.test.ts -t "family descriptor wiring keeps member-specific commands aligned with generic health reads"`
- `pnpm --filter @healthybob/cli exec vitest run packages/cli/test/list-cursor-compat.test.ts`
- `pnpm --filter @healthybob/cli exec vitest run packages/cli/test/incur-smoke.test.ts`
- `pnpm --filter @healthybob/cli exec vitest run packages/cli/test/stdin-input.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- targeted CLI tests and required repo verification commands pass without descriptor-metadata regressions

## Verification Results

- `pnpm exec vitest run --no-coverage packages/cli/test/health-tail.test.ts -t "goal descriptor wiring keeps noun-specific and generic reads aligned"`: passed
- `pnpm exec vitest run --no-coverage packages/cli/test/health-tail.test.ts -t "family descriptor wiring keeps member-specific commands aligned with generic health reads"`: passed
- `pnpm exec vitest run --no-coverage packages/cli/test/list-cursor-compat.test.ts packages/cli/test/incur-smoke.test.ts packages/cli/test/stdin-input.test.ts`: passed
- `pnpm typecheck`: passed
- Simplify pass: no additional behavior-preserving cleanup beyond the helper extraction itself
- Coverage audit: no new high-impact tests needed beyond the existing targeted CLI coverage already exercised above
- Final review: no actionable findings in the scoped descriptor diff
- `pnpm test`: failed for unrelated current-tree issues outside this lane, including missing built query artifacts plus unrelated compile/runtime failures in `packages/cli/src/usecases/integrated-services.ts`, `packages/cli/src/inbox-services.ts`, and other active-lane files
- `pnpm test:coverage`: failed for unrelated current-tree type errors outside this lane in `packages/cli/src/commands/sample-query-command-helpers.ts` and `packages/cli/src/usecases/integrated-services.ts`
Completed: 2026-03-17
