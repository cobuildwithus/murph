# CLI Typed Parity Add Batch

## Goal

Move the next agent-facing CLI write surfaces to typed incur args/options while preserving full current raw-JSON payload parity through explicit fallback/import paths where nested batch payloads are still the right interface.

## Scope

- `meal add`
- `measurement add`
- `workout add`
- `workout format save`
- `capture add`
- Adjacent `samples add` / `samples import-json` typed/import split already present in the dirty CLI lane, to keep generated incur artifacts and event import-json tests self-consistent.

## Success Criteria

- The canonical agent-visible command path exposes typed args/options for all fields currently accepted by simple/direct raw JSON payloads.
- Any remaining `--input @file.json` / stdin support is clearly reserved for batch, import, or deeply nested advanced payloads and is not the only way to populate ordinary fields.
- Focused tests prove schema exposure, persistence mapping, and validation behavior for the new typed flags.
- Generated incur artifacts and command manifests are refreshed or blockers are documented.
- Required repo workflow audits and package verification run before handoff.

## Constraints

- Preserve unrelated dirty work in hosted/runtime/research and earlier CLI lanes.
- Avoid broad CLI abstractions unless they remove real duplication in the touched command modules.
- Keep command descriptions truthful for humans and agents.
- Do not introduce `as any` or lazy cast-based type silencing.

## Plan

1. Fan out five workers with narrow ownership for each command surface.
2. Locally integrate returned command/test changes and reconcile shared `workout.ts` edits.
3. Refresh generated CLI metadata and focused typed-agent schema expectations.
4. Run focused package tests, typecheck or scoped verification as allowed by current branch state, and required audits.
5. Commit the scoped batch with the active plan closed.
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
