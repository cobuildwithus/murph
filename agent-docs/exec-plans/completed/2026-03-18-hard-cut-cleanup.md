# Hard-cut cleanup

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Apply the supplied hard-cut cleanup so selected assistant-state, history-read, and query lookup compatibility paths are removed and the docs/tests reflect the stricter behavior.

## Success criteria

- Assistant session/index/automation reads accept only the current canonical schemas for this cut.
- Assistant contract schemas reject extra legacy fields instead of silently tolerating them.
- History reads no longer normalize the listed legacy field aliases into canonical keys.
- Query lookup-family classification no longer treats `audit:`, `event:`, `experiment:`, or `sample:` ids as supported query ids.
- Contract docs and focused tests describe the hard cutover accurately.
- The `normalizeProviderOptions(...)` path remains intact in `assistant/store.ts`.

## Scope

- In scope:
  - `packages/cli/src/assistant/store.ts`
  - `packages/cli/src/assistant-cli-contracts.ts`
  - `packages/cli/src/assistant/ui/ink.ts`
  - `packages/cli/test/assistant-state.test.ts`
  - `packages/core/src/history/api.ts`
  - `packages/core/test/health-history-family.test.ts`
  - `packages/query/src/id-families.ts`
  - `README.md`
  - `docs/contracts/01-vault-layout.md`
  - `docs/contracts/03-command-surface.md`
- Out of scope:
  - next-step cleanup candidates called out in the supplied audit, especially `packages/query/src/model.ts`
  - inbox attachment-id hard cuts
  - setup shim consolidation

## Constraints

- Merge on top of existing dirty assistant-memory work without reverting adjacent changes.
- Keep the change narrowly scoped to the supplied hard-cut items.
- Do not reintroduce deleted compatibility paths while resolving conflicts.

## Risks and mitigations

1. Risk: removing assistant legacy parsing could accidentally drop newer assistant-memory behavior.
   Mitigation: patch only the legacy-read branches and keep current provider-option/provenance code intact.
2. Risk: doc/test wording could drift from actual runtime behavior.
   Mitigation: update focused assertions and contract text in the same change.
3. Risk: legacy-id test coverage may be implicit rather than direct.
   Mitigation: add or adjust focused query assertions if existing coverage does not pin the hard cut sufficiently.

## Tasks

1. Remove the targeted assistant legacy parsing/migration paths while preserving current schema/provenance behavior.
2. Tighten assistant schemas with strict parsing and update the focused assistant-state test.
3. Remove the listed history aliases and legacy id families, then update focused tests.
4. Update the affected contract/docs wording and the remaining Ink UI string.
5. Run simplify, coverage audit, required checks, final review, remove the coordination row, and commit the touched files.
Completed: 2026-03-18
