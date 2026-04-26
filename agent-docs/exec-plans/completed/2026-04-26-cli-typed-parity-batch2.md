# CLI Typed Parity Batch 2

## Goal

Move the next agent-visible CLI command group away from raw JSON as the canonical input path by adding typed incur args/options with parity against the existing JSON payload schemas.

Success criteria:

- `provider`, `recipe`, `food`, `blood-test`, and `scheduled-log` have canonical typed commands for create/update usage.
- Each typed command covers the same fields accepted by the existing raw JSON input path, except where a field is explicitly documented as import-only because it is structurally nested or unsafe to flatten.
- Existing raw JSON commands remain available only as import/bulk/advanced escape hatches.
- Focused tests prove field mapping, validation, and no-write failures for malformed typed inputs.
- Shared command metadata and generated incur artifacts are refreshed or a blocker is recorded with exact failing targets.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not touch the active regimen/protocol hard-cut except where an imported type or CLI root already requires local integration.
- Worker write scopes stay disjoint; shared manifest/generated integration is handled after worker patches are reviewed.
- No `as any` or broad assertion casts to hide type gaps.
- Do not include local account names, home paths, secrets, or direct identifiers in files, tests, logs, or commits.

## Work Plan

1. Spawn five worker agents:
   - provider typed save
   - recipe typed save
   - food typed save
   - blood-test typed save
   - scheduled-log typed save
2. Review each patch for typed parity against the raw JSON schema.
3. Integrate shared command registration and metadata locally.
4. Run focused CLI tests and the truthful scoped verification lane.
5. Run required completion review passes.
6. Commit only the typed-parity batch files if safe.

## Verification Targets

- Focused Vitest files added by each worker.
- `pnpm --dir packages/cli typecheck`, unless still blocked by unrelated regimen/protocol drift.
- `bash scripts/workspace-verify.sh test:diff <typed-parity-files>`, unless blocked by unrelated active branch failures.
- Incur artifact generation, unless still blocked by unrelated build/typecheck drift.

## Handoff Notes

Current known blocker before this plan: broad CLI typecheck and incur generation are already red from active regimen/protocol hard-cut and source/dist drift. Do not attribute that to this batch unless the failing target changes to one of this plan's files.
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
