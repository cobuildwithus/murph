# Green checks repair

Status: completed
Created: 2026-03-24
Updated: 2026-03-28

## Goal

- Restore the repository to a green verification state for the required commands: `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.

## Success criteria

- The current build/type failures in `packages/cli`, `packages/query`, `packages/parsers`, and assistant-related full-suite regressions are resolved.
- Required repo verification commands pass without changing intended runtime behavior.
- Any focused supporting tests added stay narrow to the repaired failure surfaces.

## Scope

- In scope:
  - current failing build/type boundaries in contracts export visibility/generated-schema drift, core build cleanup stability, query local build ordering, parsers package typecheck stability, assistant full-suite/runtime verification, assistant CLI guidance assertion stability, hosted-web package resolution, and coverage-run subprocess behavior
  - minimal targeted assistant, app, and runtime child-process edits needed to keep repo verification green
- Out of scope:
  - unrelated feature work already in flight in adjacent assistant/query/inbox lanes
  - broad refactors beyond what is needed to restore green checks

## Constraints

- Preserve existing user-facing CLI behavior unless a failing test proves a contract mismatch.
- Keep the fix narrow and biased toward type/build correctness instead of feature reshaping.
- Respect overlapping active lanes by preserving adjacent edits and limiting scope to current verification failures.

## Tasks

1. Inspect the current repo verification failures and map each to the exact file/symbol boundary.
2. Fix the failing build/runtime surfaces with the smallest behavior-preserving edits.
3. Run focused checks on the repaired assistant and CLI test-helper areas.
4. Run `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
5. Record outcomes, run completion audits, and commit the repair.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Completed: 2026-03-28
