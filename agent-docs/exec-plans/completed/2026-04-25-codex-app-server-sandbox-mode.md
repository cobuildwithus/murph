# Fix Codex app-server sandbox mode mapping

## Goal

Fix local Codex app-server turns so Murph sends protocol-correct thread sandbox mode values and no longer fails auto-reply provider turns before `turn/start`.

Success criteria:

- `thread/start` and `thread/resume` use Codex app-server `SandboxMode` values (`read-only`, `workspace-write`, `danger-full-access`) instead of sandbox-policy discriminator values.
- Focused assistant-engine Codex runtime tests cover all supported sandbox modes.
- Directly coupled CLI Codex wrapper tests expect the same app-server payload shape.
- A direct local Codex app-server RPC probe confirms the selected value is accepted by the installed Codex binary.
- No secrets, raw channel identifiers, or local personal paths are added to source/docs/tests.

## Constraints

- Preserve unrelated dirty work and active ledger rows.
- Keep the fix at the JSON-RPC request boundary; do not change Murph operator-facing sandbox enums or CLI args unless direct evidence requires it.
- Do not add dependencies.

## Plan

1. Register this active lane in the coordination ledger.
2. Patch the Codex app-server thread context mapper.
3. Update focused Codex runtime tests so the expected values match the app-server schema.
4. Update directly coupled CLI wrapper tests exposed by the scoped diff lane.
5. Run focused tests plus direct local Codex app-server proof.
6. Run required completion audit passes and final verification.
7. Close the plan through the repo workflow, committing only the scoped fix if safe.

## Verification

- PASS: `pnpm exec vitest run packages/assistant-engine/test/assistant-codex-runtime.test.ts --config vitest.config.ts --no-coverage`
- PASS: `pnpm exec vitest run packages/cli/test/assistant-codex.test.ts --config packages/cli/vitest.workspace.ts --no-coverage`
- PASS: `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts --config packages/cli/vitest.workspace.ts --no-coverage -t "keeps active execution plans aligned"`
- PASS: `pnpm --dir packages/assistant-engine typecheck`
- PASS: `pnpm typecheck`
- PASS: direct non-sensitive Codex app-server RPC smoke with a temp cwd confirmed `thread/start` accepts `sandbox: "danger-full-access"`.
- PASS: security/privacy review found no regression or identifier leakage in the scoped diff.
- PASS: coverage-write review found the assistant-engine runtime and CLI wrapper tests sufficient; no extra edits needed.
- BLOCKED (unrelated dirty work): `pnpm --dir packages/assistant-engine test:coverage` ran all assistant-engine tests successfully but exited 1 because `src/assistant/hosted-context-diagnostics.ts` branch coverage is below the configured threshold.
- BLOCKED (unrelated dirty work): `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant-codex/app-server-requests.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/cli/test/assistant-codex.test.ts` passed package typechecks and assistant package tests, then failed in `packages/cli/test/incur-smoke.test.ts` because dirty `packages/assistant-engine/src/inbox-multimodal.ts` currently fails Vite/OXC parsing.

## Notes

- Root cause found in local diagnostics: the installed Codex app-server rejects `dangerFullAccess` for `thread/start.sandbox` and accepts dashed `SandboxMode` values.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
