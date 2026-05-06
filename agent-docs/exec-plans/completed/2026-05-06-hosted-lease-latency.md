# Hosted Lease Latency Probe

## Goal

Measure the added latency of reintroducing live Durable Object lease validation on hosted runner outbound side-effect paths, using a focused Worker/DO E2E probe.

## Constraints

- Keep this diagnostic-only unless the measured cost justifies production changes in a separate step.
- Do not touch unrelated dirty hosted runner, billing, usage, or latency work.
- Do not log secrets, raw payloads, local paths, or personal identifiers.
- Prefer a simple direct live-lease measurement over a cache design.

## Plan

1. Add a test-only Worker route that measures header-only lease parsing versus live DO lease validation.
2. Add a Workers-runtime E2E test that calls the route and reports p50/p95/average overhead.
3. Run the focused Workers E2E test and typecheck-relevant verification.
4. Use the measured latency to recommend whether the live check is worth adding.

## Verification

- Focused: `pnpm exec vitest run --config apps/cloudflare/vitest.workers.config.ts apps/cloudflare/test/workers/runner-lease-latency-e2e.test.ts`
- Required follow-up for Cloudflare test changes: `pnpm --dir apps/cloudflare verify` or a justified scoped lane if broader checks are blocked by unrelated worktree state.

## State

- Created before code edits.
- Current work is diagnostic only; no production side-effect lease behavior has been changed.
- Focused Workers-runtime E2E result after final probe shape: `samples=250`, `headerAvg=0.004ms`, `liveAvg=0.664ms`, `addedAvg=0.66ms`, `addedP50=1ms`, `addedP95=1ms`.
- `pnpm --dir apps/cloudflare verify` is blocked by unrelated TypeScript errors in the pre-existing untracked active-turn latency E2E (`input.label` missing from a local helper parameter type).
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
