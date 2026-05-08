# Hosted Local E2E Green

## Goal

Get the canonical hosted-local E2E suite passing via `pnpm hosted-local e2e`.

## Context

- The aggregate suite reached `apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts` and stalled.
- Observed DB state showed later Linq test users had `member.activated` mailbox rows but no checkpointed workspace.
- Runtime logs repeatedly reported `mailbox.imported` with `fetchedCount: 0`, `importedCount: 0`, and assistant automation `progressed: false`.

## Constraints

- Preserve unrelated dirty work and overlapping active hosted-runtime edits.
- Avoid exposing local paths, user identifiers, secrets, raw payloads, or provider request bodies in files, commits, or handoff.
- Fix root cause rather than bypassing E2E coverage.

## Plan

1. Reproduce the focused Linq E2E failure with the local harness.
2. Trace wake append, runner status, mailbox import watermark, and workspace checkpoint behavior.
3. Apply the smallest fix to the owning runtime/control-plane path.
4. Verify focused scenario(s), then the aggregate `pnpm hosted-local e2e`.
5. Run required typecheck/tests/audits for touched surfaces before handoff.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-runner.test.ts` passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-runtime-internal-routes.test.ts` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts -t "hosted-local e2e isolation"` passed.
- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/dev-hosted-local/environment.test.ts -t "hosted-local e2e isolation flag"` passed.
- `MURPH_HOSTED_LOCAL_E2E_FAST_GATE=1 pnpm hosted-local e2e linq-first-contact --no-bundle` passed.
- `pnpm hosted-local e2e linq-first-contact --no-bundle` passed.
- `pnpm hosted-local e2e linq-webhook --no-bundle` passed after status/foreground-contract fixes.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/helpers/hosted-local-dev-harness.test.ts apps/cloudflare/test/hosted-local-e2e-support.test.ts apps/cloudflare/test/run-hosted-local-e2e.test.ts` passed.
- `pnpm hosted-local e2e linq-first-contact --no-bundle` passed after the local runner timeout/harness retry fix.
- `pnpm hosted-local e2e --no-bundle` passed: 7 files, 18 tests.
- `pnpm hosted-local e2e` passed: fresh bundle build, Docker base prep, 7 files, 18 tests.
- `pnpm typecheck` passed.
- `pnpm test:diff` passed.
- `git diff --check` passed.

## Current state

- Canonical hosted-local E2E is green.
- The local harness now prepares the runner base image once, skips duplicate dev-worker base builds after validation, bounds the local E2E runner timeout to fit test recovery windows, and continues retrying transient runner errors while committed mailbox lag remains.
- Scheduled-reminder delivery now carries deterministic hosted idempotency context.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
