# Device Syncd Wearable Audit Fixes

## Goal

Apply the provided wearable architecture audit fixes in `packages/device-syncd` and the directly aligned docs/tests.

## Scope

- Harden `device-syncd` default bind host to localhost.
- Make provider config loading catalog-driven instead of bespoke WHOOP/Oura branching.
- Ensure manual reconcile enqueues every provider-scheduled job and returns the full queue result.
- Prevent concurrent claimed jobs for the same account.
- Update architecture/runtime/package docs and targeted tests to match the new behavior.

## Constraints

- Preserve unrelated in-progress work elsewhere in the repo.
- Do not read `.env*` files or expose secrets.
- Follow the required completion workflow and repo verification commands before handoff.

## Verification

- Simplify pass: reviewed the diff and kept the patch as-is; no additional behavior-preserving cleanup was justified.
- Coverage audit: added focused `packages/device-syncd/test/service.test.ts` coverage for multi-job manual reconcile enqueueing plus per-account claim serialization, and added the localhost-default host assertion in `packages/device-syncd/test/config.test.ts`.
- `pnpm --dir packages/device-syncd typecheck`: passed.
- `pnpm exec vitest run packages/device-syncd/test/config.test.ts packages/device-syncd/test/service.test.ts --no-coverage --maxWorkers 1`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: failed for unrelated CLI smoke assertions in `packages/cli/test/inbox-incur-smoke.test.ts` that expect inbox help text not currently present in the built CLI output.
- `pnpm test:coverage`: failed for unrelated assistant build/type errors in `packages/cli/src/assistant-codex.ts` and `packages/cli/src/assistant/ui/ink.ts` before the coverage suite reached the device-syncd slice.
- `bash scripts/check-agent-docs-drift.sh`: passed after updating `agent-docs/index.md`.
- `bash scripts/doc-gardening.sh --fail-on-issues`: passed.
Status: completed
Updated: 2026-03-17
Completed: 2026-03-17
