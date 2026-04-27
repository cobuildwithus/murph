# Commons Protocol Explore

## Goal

Add a first-class `vault-cli commons protocol explore` command that makes protocol-family expansion mechanically easy for assistant onboarding flows.

Success criteria:

- A general query such as `sauna` returns matched protocol candidates plus their family context.
- For each matched protocol, output includes parent family, related protocol variants, category-derived traits such as Murph canonical or source-attributed/external, caution level when available, and exact revision ids.
- The command is covered by focused CLI/runtime tests and generated CLI type metadata is refreshed.

## Constraints

- Preserve public Health Commons versus private vault protocol separation.
- Do not edit unrelated hosted runtime, web, research, or generated Health Commons content.
- Keep implementation minimal and aligned with existing `commons` command/read-model patterns.
- Do not expose local account or home-directory identifiers in generated files, docs, commit text, or logs.

## Current State

- Existing `commons search` and `commons protocol list` can find Finnish Dry Sauna, but broad search ranking can surface a source-attributed protocol first.
- Runtime relation APIs already expose parent-family and related-protocol relationships, but direct CLI output does not make those relationships first-class for protocol setup.

## Plan

1. Add a small reusable protocol exploration helper in the public Health Commons runtime or CLI layer.
2. Add `commons protocol explore <query-or-key>` with structured output.
3. Add focused tests for the sauna family expansion case.
4. Run package-appropriate verification and required completion audits.
5. Commit only this task’s touched paths.

## Verification

- `pnpm --dir packages/cli gen:config-schema` passed and refreshed generated CLI artifacts.
- `pnpm --dir packages/cli exec tsx src/bin.ts commons protocol explore sauna --limit 5 --format json` returned the sauna family, grouped dry-sauna variants, labeled Bryan Johnson Sauna as external/source-attributed/high caution, and selected Finnish Dry Sauna as the starter candidate with revision ids.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/commons-command-coverage.test.ts --no-coverage` passed.
- `pnpm typecheck` completed successfully in this checkout; it printed an unrelated workspace-boundary warning for active Cloudflare runtime work.
- `pnpm --dir packages/cli verify:package-shape` passed.
- `pnpm --dir packages/cli verify:coverage` is blocked by unrelated dirty-tree CLI coverage failures in document/meal/intervention/workout tests; the focused commons test still passes.
- `git diff --check -- packages/cli/config.schema.json packages/cli/src/commands/commons.ts packages/cli/src/incur.generated.ts packages/cli/test/commons-command-coverage.test.ts` passed.

## Handoff Notes

- Added first-class public Health Commons protocol-family exploration under `commons protocol explore`.
- The implementation stays in the read-only public commons command path and does not read or write private vault protocols.
Status: completed
Updated: 2026-04-27
Completed: 2026-04-27
