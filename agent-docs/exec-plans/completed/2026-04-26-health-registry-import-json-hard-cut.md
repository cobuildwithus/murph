# Health Registry Import JSON Hard Cut

## Goal

Make `goal`, `condition`, `allergy`, `family`, and `genetics` expose canonical typed `save` commands plus explicit `import-json` commands for advanced JSON imports. Remove legacy agent-visible `upsert` commands for those registry groups.

## Success Criteria

- `goal save`, `condition save`, `allergy save`, `family save`, and `genetics save` remain typed and canonical.
- `goal import-json`, `condition import-json`, `allergy import-json`, `family import-json`, and `genetics import-json` exist for JSON file/stdin import.
- The old `upsert` commands for those five groups are absent from incur schemas, generated types, and agent-visible manifests.
- Tests cover the hard cut and generated incur artifacts are refreshed.

## Scope

- `packages/cli/src/commands/health-command-factory.ts`
- `packages/cli/src/commands/health-{goal,condition,allergy,family,genetics}-save.ts`
- `packages/cli/src/vault-cli-command-manifest.ts`
- `packages/assistant-engine/src/assistant-cli-tools/**`
- `packages/cli/test/**` focused CLI schema/help/import coverage
- `packages/assistant-engine/test/**` focused native tool catalog coverage
- `packages/cli/config.schema.json`
- `packages/cli/src/incur.generated.ts`

## Constraints

- Greenfield behavior: do not add backward-compatible `upsert` aliases for these five groups.
- Preserve unrelated dirty work in the shared checkout.
- Keep JSON blob input explicit as `import-json`; typed `save` is the default command for agents.
- Use GPT-5.5 high implementation workers as requested, with disjoint noun ownership where possible.

## Plan

1. Add a shared health CRUD factory path for named JSON import commands.
2. Configure the five registry groups to register `import-json` and skip `upsert`.
3. Update descriptor-based and native assistant tool catalogs so agents no longer see the old health registry `upsert` path.
4. Update tests that intentionally reference the JSON fallback.
5. Regenerate incur schema/type artifacts.
6. Run focused CLI/assistant verification, required review passes, and create a scoped commit.

## Verification

- `pnpm --dir packages/cli gen:config-schema`
- Focused CLI Vitest coverage for typed save/import-json hard cut
- Focused assistant-engine and inbox model tool catalog coverage
- `pnpm --dir packages/cli typecheck`
- Diff-scoped workspace verification where feasible
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
