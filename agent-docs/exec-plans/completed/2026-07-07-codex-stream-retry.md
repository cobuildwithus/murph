# Codex Stream Retry Hardening

## Goal

Reduce hosted Murph reply brittleness when Codex/OpenAI response streams
disconnect before completion.

Success criteria:

- Inspect the sibling Codex checkout for native retry/default behavior.
- Keep Murph aligned with Codex-native retry semantics where possible.
- Patch only the narrow hosted-runtime config gap proven by logs and Codex
  defaults.
- Add focused regression coverage for hosted Codex config generation.
- Run required scoped verification for `packages/assistant-runtime`.

## Constraints

- Preserve Codex as the substrate; do not add a parallel scheduler, queue, or
  broad retry manager.
- Do not implicitly replay Murph-side side-effecting tools.
- Keep diagnostics metadata-only and avoid secrets or direct identifiers.
- Preserve unrelated working-tree edits.

## Working Set

- `../codex` for native Codex defaults inspection.
- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`

## State

- Current production evidence: July 7 hosted turn logged `stream-disconnected`
  with `willRetry=false`, after Codex had already started a provider action.
- Sibling Codex default: `stream_max_retries = 5`.
- Proven Murph gap: hosted Codex config explicitly wrote
  `stream_max_retries = 0`, disabling Codex-native provider stream reconnects.
- Chosen fix: align hosted config with Codex's native stream retry default
  instead of adding Murph-side replay logic for side-effecting turns.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-codex-config.test.ts`
  passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts -t "emits metadata-only phase boundary logs for runtime startup"`
  passed.
- `pnpm --dir packages/assistant-runtime test` is blocked by the unrelated
  `hosted-runtime-workspace-entrypoint.test.ts` case
  `"reports mailbox budget exhaustion only after deferring an overflow item"`,
  which also fails when run alone with `workspace.read,mailbox.fetch` and a temp
  runtime-state `ENOENT`.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
