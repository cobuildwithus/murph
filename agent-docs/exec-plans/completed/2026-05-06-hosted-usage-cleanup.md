# Hosted Usage Cleanup

## Goal

Simplify the direct hosted usage recording implementation after review feedback:

- Keep usage recording best-effort and non-blocking for assistant turn latency.
- Move the hosted usage record contract out of local runtime-state ownership.
- Strengthen runtime usage recording types.
- Remove stale export/import/pending-file vocabulary where it remains in live code, tests, and docs.
- Delete small dead or duplicated hosted usage route/response helpers.

## Constraints

- Do not reintroduce local pending usage files for the normal path.
- Server-side idempotency by `usageId` remains the duplicate protection mechanism.
- Legacy pending usage in old snapshots is intentionally out of scope for this cleanup because current usage volume is low.
- Preserve unrelated dirty worktree edits.
- Do not include local usernames, home paths, secrets, prompts, raw Authorization headers, or direct personal identifiers in docs, code, tests, or logs.

## Working Set

- `packages/hosted-execution/src/**`
- `packages/assistant-engine/src/assistant/{execution-context,service-usage,provider-turn-runner}.ts`
- `packages/assistant-runtime/src/hosted-runtime/{platform,workspace-assistant-phase}.ts`
- `apps/cloudflare/src/**`
- `apps/web/app/api/internal/hosted-execution/usage/record/route.ts`
- `apps/web/src/lib/hosted-execution/usage*.ts`
- Focused tests/docs for those seams.

## Verification Plan

- Focused package/app tests for assistant-engine, assistant-runtime, hosted-execution, runtime-state, web usage, and Cloudflare runtime platform.
- `pnpm typecheck` if feasible.
- Report any unrelated pre-existing red checks explicitly.

## State

- Status: implementation complete; handoff pending because the worktree has unrelated overlapping edits and a pre-existing staged web test type error.
- Created: 2026-05-06T08:42:11Z.
- Done: Hosted usage recording is direct, best-effort, and non-blocking for assistant turn latency.
- Done: Hosted usage contracts live in hosted-execution; runtime-state no longer owns assistant usage records.
- Done: The signed usage callback uses a single-record `{ usage }` request and `{ recorded, usageId }` response.
- Done: The web callback route uses the shared hosted-execution parser and bounded body reads; the Cloudflare web-control proxy also bounds allowlisted POST bodies.
- Done: Raw usage metadata is fail-closed to token/count fields at the shared usage parser.
- Verification: Focused hosted-execution, assistant-engine, assistant-runtime, runtime-state, web usage/internal, Cloudflare runtime platform, and runner-outbound tests passed. Root `pnpm typecheck` passed before the last body-limit patch; `apps/web typecheck` after the patch is blocked by an unrelated staged failure in `apps/web/test/hosted-billing-settings.test.tsx`.
- Residual risk: usage recording is intentionally best-effort. Callback failures can undercount usage, but they do not add assistant-turn latency.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
