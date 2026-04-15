# Get `packages/assistant-runtime` green and above package-local coverage thresholds

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Make `packages/assistant-runtime` pass its package-local verification and coverage gates.
- Keep the fix isolated to `packages/assistant-runtime/**` plus the required workflow metadata.

## Success criteria

- `pnpm --dir packages/assistant-runtime typecheck` passes.
- `pnpm --dir packages/assistant-runtime test` passes.
- `pnpm --dir packages/assistant-runtime test:coverage` passes.
- Any added or changed tests raise honest coverage on the current `src/**/*.ts` surface without weakening thresholds.

## Scope

- In scope:
- `packages/assistant-runtime/**`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-assistant-runtime-package-green.md}`
- Out of scope:
- root or shared coverage-threshold changes unless an honest package-local fix proves impossible without them
- unrelated package or app coverage work already active elsewhere in the tree

## Current state

- `pnpm --dir packages/assistant-runtime test:coverage` currently fails on `src/hosted-runtime.ts`, `src/hosted-device-sync-runtime.ts`, and `src/hosted-runtime/{context,events,execution,maintenance,parsers}.ts`.
- Existing package-local tests already cover many hosted seams, but branch gaps remain around dispatch routing, runtime context assembly, maintenance/execution error paths, parser helpers, and device-sync reconciliation edge cases.
- The package already has in-flight local edits in `src/hosted-runtime/{context,maintenance}.ts` and several test files, so this lane must preserve those edits and integrate on top of them.

## Risks and mitigations

1. Risk:
   Overlap with existing in-flight assistant-runtime edits causes conflicts.
   Mitigation:
   Read the live file state first, keep worker ownership disjoint, and integrate centrally.
2. Risk:
   Coverage work sprawls into runtime changes that are not necessary.
   Mitigation:
   Prefer deterministic tests first and only touch source when a path is genuinely untestable or incorrect.
3. Risk:
   Package-local fixes depend on broader root coverage or hosted-runner changes.
   Mitigation:
   Keep this lane package-local and report any root integration blocker with concrete evidence before widening scope.

## Tasks

1. Register the assistant-runtime lane and inspect the current package-local failures and overlapping edits.
2. Split the uncovered seams across parallel worker lanes with disjoint file ownership.
3. Integrate focused test additions and any minimal source fixes required to exercise the real behavior.
4. Re-run package-local verification and coverage.
5. Run the required final audit review, resolve findings, and finish with a scoped commit.

## Verification

- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-runtime test`
- `pnpm --dir packages/assistant-runtime test:coverage`
Completed: 2026-04-08
