# CLI helper cleanup

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Consolidate exact duplicated CLI-internal helpers and remove one unused private wrapper while preserving all externally visible CLI behavior.

## Success criteria

- Shared helpers replace the duplicate `parseHeadersJsonOption`, `resolveEffectiveTopLevelToken`, and `firstString` implementations with no string, branching, or return-shape drift.
- The duplicated top-level-option value set is defined once and reused where token resolution logic depends on it.
- `registerFactoryCommandGroup` is removed only if it remains unused in the current tree.
- Existing CLI tests covering assistant, inbox, setup, read-model rendering, and health tail behavior stay green.

## Scope

- In scope:
- CLI-internal helper consolidation across the explicitly listed files
- removing the dead private wrapper if repo search still shows no callers
- targeted test updates only if current coverage needs to lock preserved behavior more directly
- Out of scope:
- command-surface redesign
- new CLI features or validation text changes
- widening the cleanup beyond the exact duplicates and dead wrapper called out by the user

## Constraints

- Preserve exact validation messages and top-level argument parsing behavior.
- If a helper’s current behavior may be indirectly relied on, keep the shared replacement byte-for-byte equivalent.
- Respect concurrent non-exclusive CLI lanes already registered in the coordination ledger.

## Risks and mitigations

1. Risk: moving helpers could accidentally change error strings or option precedence.
   Mitigation: copy the current logic exactly first, then switch imports with targeted regression checks.
2. Risk: overlapping `packages/cli` edits may already exist in the touched files.
   Mitigation: inspect current file state carefully, preserve adjacent edits, and keep the change narrowly scoped to the named helpers.
3. Risk: removing the wrapper could hide an indirect usage or typing side effect.
   Mitigation: confirm repo-wide usage before deletion and rerun the built CLI verification path through the required repo checks.

## Tasks

1. Inspect the duplicate helper implementations and verify they are exact or safely centralizable without behavior drift.
2. Move the helpers into the shared CLI helper module, update imports/call sites, and remove the local duplicates.
3. Confirm the stale wrapper is unused, then remove it.
4. Run the completion workflow audits plus required repo verification, then commit the scoped files.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Focused checks: targeted `packages/cli` tests during implementation if faster feedback is useful
Completed: 2026-03-17
