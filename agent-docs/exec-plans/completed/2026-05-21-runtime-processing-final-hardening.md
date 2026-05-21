# Runtime processing final hardening

Status: completed
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Finish the hosted runtime processing cutover so Temporal remains the only
  orchestrator, Cloudflare only accepts/activates processing, and the accepted
  start/wake path cannot hide dead runtime attempts behind stale write fences.

## Success criteria

- `ensureRuntimeProcessing` returns after start/wake acceptance and registers
  background runtime work with Durable Object lifetime ownership.
- Fresh startup races are short-rechecked, while stale non-wakeable write
  fences are replaced instead of reported as healthy.
- Cold-start and replacement acceptance use short rechecks; confirmed active
  wakes may keep the dirty-runtime recheck margin.
- Temporal keeps current-run Activity timeout attributes replay-safe, clamps
  legacy long ensure timeouts on continue-as-new, and keeps legacy
  ensure-execution compatibility explicit.
- Docs, logs, and tests no longer describe webhook-to-Cloudflare runner nudges
  as the normal path.

## Scope

- In scope:
  - Cloudflare `UserRunner` start/wake lifecycle safeguards and focused tests.
  - Hosted execution ensure-processing contract cleanup.
  - Temporal workflow timeout normalization, wait-reason naming, and focused
    tests.
  - Stale docs/test wording that conflicts with Temporal-only orchestration.
- Out of scope:
  - Removing legacy ensure-execution route/activity before deploy-skew drains.
  - Adding a webhook-to-Cloudflare fast path.
  - Broad hosted-local E2E expansion beyond focused regression proof.

## Constraints

- Preserve unrelated dirty verification/CLI edits in the current checkout.
- Preserve unrelated active plan rows; this plan owns only the files touched for
  runtime-processing hardening.
- Keep Temporal workflow state pointer-only and deterministic.
- Keep Cloudflare logs metadata-only and free of payloads, local paths, raw ids,
  prompts, provider responses, and secrets.

## Tasks

1. Patch Cloudflare lifecycle ownership, stale-fence replacement, and recheck
   timing.
2. Patch Temporal timeout handling and processing retry naming.
3. Simplify retry-later contract surface and stale terminology where it matters.
4. Add focused regression tests for waitUntil, stale non-wakeable fences, short
   cold-start rechecks, legacy replay compatibility, and workflow timeout
   normalization on continue-as-new.
5. Run focused verification plus typecheck, completion audits, and scoped commit.

## Verification

- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-orchestration-control.test.ts test/temporal-env.test.ts`
- `pnpm --dir packages/hosted-orchestrator-temporal exec vitest run --config vitest.config.ts --no-coverage test/hosted-user-runtime-workflow.test.ts test/ensure-cloudflare-execution.test.ts test/activity-observation.test.ts`
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/user-runner-alarm.test.ts test/runner-container.test.ts test/container-entrypoint.test.ts test/index.test.ts test/user-runner-status.test.ts test/runner-state-store-wake-backoff.test.ts test/runner-state-store.bundle-slots.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-stripe-webhook-reconciliation.test.ts apps/web/test/hosted-onboarding-stripe-webhook-service.test.ts`
- `pnpm typecheck`
- `git diff --check`
- Diff privacy scan for local paths, raw auth headers, bearer tokens, OpenAI-style API keys, and private-key markers.
Completed: 2026-05-21
