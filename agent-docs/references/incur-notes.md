# Incur Notes

Last verified: 2026-03-13

## When To Read This

- If you touch `packages/cli`, use the `incur` skill first and read this note before changing routing, help text, schemas, discovery output, or generated CLI typing.

## Guardrails

- Model nested verbs with real mounted sub-CLIs. Do not mimic nested commands with argv rewrites or synthetic action arguments.
- Treat `--format`, `--json`, `--verbose`, `--schema`, `--llms`, `skills add`, and `--mcp` as incur-owned framework behavior. Healthy Bob docs should focus on command semantics unless the repo intentionally constrains that surface.
- Keep the root CLI default-exported from `packages/cli/src/index.ts`.
- Refresh `packages/cli/src/incur.generated.ts` when command topology changes. If `incur gen` is blocked by an unrelated build problem, record that explicitly in handoff notes.
- Remember that package CLI tests execute `packages/cli/dist/bin.js`; source runs through `pnpm exec tsx packages/cli/src/bin.ts ...` are only a debugging shortcut.

## Likely Follow-Up Files

- `packages/cli/src/commands/**`
- `packages/cli/src/index.ts`
- `packages/cli/src/incur.generated.ts`
- `docs/contracts/03-command-surface.md`
- `e2e/smoke/scenarios/**`
