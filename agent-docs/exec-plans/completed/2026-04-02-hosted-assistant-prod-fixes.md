# Hosted Assistant Prod Fixes

## Goal

Land the pre-prod hosted assistant fixes needed for a hard greenfield cutover without preserving dead compatibility paths beyond the current repo/runtime contract.

## Why

- The hosted assistant explicit-config cutover currently leaves the operator config seam half-migrated.
- Older hosted workspaces can remain permanently unconfigured because hosted assistant seeding only runs during `member.activated`.
- Hosted profiles still permit persisted `headers` and a free-form `options` bag that should not remain in the v1 hosted surface.

## Scope

- `packages/assistant-core/src/{assistant/hosted-config.ts,assistant-backend.ts,hosted-assistant-config.ts,operator-config.ts}`
- `packages/assistant-runtime/src/hosted-runtime/{context.ts,models.ts,summary.ts}`
- Focused hosted/operator-config tests under `packages/assistant-runtime/test/**`

## Non-Goals

- No larger assistant architecture rewrite.
- No repo-wide conversion of every assistant test/helper to the backend-target model unless required by the touched seam.
- No relaxation of hosted env privacy boundaries.

## Plan

1. Make operator-config reads/writes preserve and surface the canonical assistant backend shape while still tolerating older saved assistant config documents.
2. Make hosted runtime attempt explicit hosted assistant backfill outside activation when the workspace already exists but durable hosted config is still missing.
3. Remove persisted hosted profile `headers` and generic `options` support from the hosted config seam.
4. Update focused tests and docs that define the hosted/operator-config contract.
5. Run focused verification, then repo-required verification if the touched surface is stable enough.

## Verification

- Focused Vitest coverage for hosted assistant bootstrap, hosted runtime context, and operator-config boundary behavior.
- Repo-required `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` unless blocked by unrelated baseline failures.

## Result

- Implemented tolerant operator-config reads so legacy `assistant.provider/defaultsByProvider` state is migrated instead of discarded, while malformed-but-parseable top-level config still preserves unrelated fields like `defaultVault`.
- Hosted runtime now attempts hosted assistant backfill on every hosted dispatch when durable `hostedAssistant` config is missing, while only activation still reconciles auto-reply channels.
- Hosted profiles no longer persist `headers` or a free-form `options` bag; legacy backfill drops those fields when creating durable hosted profiles.
- Added explicit hosted assistant status signaling (`missing`, `invalid`, `unready`, `legacy-defaults`, etc.) to runtime bootstrap/summary paths and updated Cloudflare node-runner expectations.

## Verification Outcome

- Passed: `pnpm vitest run packages/assistant-runtime/test/hosted-assistant-bootstrap.test.ts packages/assistant-runtime/test/assistant-core-boundary.test.ts --maxWorkers=1 --coverage.enabled=false`
- Passed: `pnpm exec tsc -p packages/assistant-core/tsconfig.json --noEmit`
- Passed: `pnpm exec tsc -p packages/assistant-runtime/tsconfig.json --noEmit`
- Passed: `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/node-runner.test.ts`
- Passed: `git diff --check`
- Fails unrelated: `pnpm typecheck` currently stops in `packages/cli/test/assistant-observability.test.ts` with `TS18048: 'receiptCheck.details' is possibly 'undefined'`.
- Fails unrelated: `pnpm test` still trips the existing `apps/web` smoke lock (`apps/web/scripts/dev-smoke.ts` reports an active Next dev process lock for pid `84824` / port `62396`).
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
