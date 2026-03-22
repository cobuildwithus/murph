## Goal

Simplify the `packages/cli` health command factory layer without changing the CLI contract: same command names, help text, schema output, examples, hints, CTA text, and routing behavior.

## Scope

- Refactor `packages/cli/src/commands/health-command-factory.ts` to reduce overlapping abstraction layers.
- Keep the descriptor-driven health entity registry, but make its binding into CRUD command groups thinner and more strongly typed.
- Update the targeted command call sites (`provider`, `event`, `experiment`, and any touched health command wrappers) to remove unnecessary result casts where possible.
- Preserve current dynamic registration through `packages/cli/src/vault-cli-command-manifest.ts`.

## Constraints

- No new meta-framework or replacement DSL.
- Preserve incur command topology and generated command metadata behavior.
- Preserve exact externally visible strings unless a test proves an existing mismatch that is unrelated to this refactor.
- Respect overlapping active work in `health-command-factory.ts` and adjacent CLI files.

## Planned Shape

1. Introduce one typed helper for repeated list-command assembly and option extraction.
2. Convert specialized entity-group builders into very thin wrappers or direct command-group assembly.
3. Tighten generic typing around CRUD service binding/result id extraction so descriptor-based callers do not need local `as z.infer<...>` casts.
4. Run required verification plus completion-workflow audit passes before handoff.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow: `simplify` -> `test-coverage-audit` -> `task-finish-review`
Status: completed
Updated: 2026-03-23
Completed: 2026-03-23
