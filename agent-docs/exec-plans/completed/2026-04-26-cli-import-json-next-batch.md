# CLI Import-JSON Next Batch

## Goal

Hard-cut the next legacy agent-visible JSON write surfaces so typed save/add commands remain canonical and JSON payloads are explicitly named import/log escape hatches.

Success criteria:

- `provider`, `food`, `recipe`, `blood-test`, and `scheduled-log` expose `save` plus `import-json`, and no longer expose `upsert` in incur generated artifacts, config schema, help, or `--llms-full`.
- Assistant native write tools use explicit JSON names for JSON payload tools, including previously hard-cut `event`.
- `automation` has a typed canonical save path before its JSON import path is renamed.
- `protocol` no longer exposes a JSON payload command named `upsert`; any remaining protocol JSON escape hatch is explicitly named.
- Tests cover schema visibility, stdin import behavior, and assistant tool catalog/tool execution names.

## Constraints

- Greenfield: no compatibility aliases or deprecated command shims.
- Preserve unrelated dirty-tree work and active ledger rows.
- Keep code changes scoped to CLI command surfaces, assistant native tool metadata, and directly coupled tests/docs.
- Do not widen into hosted runtime, Health Commons content, or unrelated assistant prompt behavior.

## Current Plan

1. Split implementation across five workers with disjoint primary write scopes.
2. Integrate worker changes in this checkout.
3. Regenerate incur artifacts and config schema.
4. Run focused CLI/assistant-engine tests, `pnpm typecheck`, and truthful diff verification.
5. Run required security/privacy, coverage, and final-review audits before commit.

## Verification Targets

- `pnpm typecheck`
- Focused CLI tests for changed command surfaces.
- Focused assistant-engine and CLI assistant tool catalog tests for native tool name changes.
- `bash scripts/workspace-verify.sh test:diff ...` over touched files when stable.

## Final Status

- Implemented the hard cut for provider, food, recipe, blood-test, scheduled-log, automation, and protocol.
- Added typed `automation save`; kept typed save as canonical for nouns that already had it.
- Regenerated incur config/schema artifacts and updated assistant-native tool names, prompt guidance, OpenClaw guidance, command docs, and command capability taxonomy.
- Required security/privacy, coverage-write, simplify, and final-review passes completed. Security and simplify follow-up findings were fixed; final review found no remaining findings.
- Verification passed for focused CLI/assistant/contracts tests, CLI package shape, root typecheck, and built CLI spot checks. Broad diff verification only failed in an unrelated `packages/device-syncd` webhook trace lifecycle test that reproduces directly and touches no files in this batch.
Status: completed
Updated: 2026-04-27
Completed: 2026-04-27
