# Hosted local e2e speed and truthfulness

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Make the hosted local e2e lane fully passing.
- Reduce local hosted e2e wall time by at least 50% from the measured baseline.
- Make the e2e tests more faithful to the underlying hosted implementation instead of relying on avoidable harness-only shortcuts.

## Scope

- `apps/cloudflare/scripts/run-hosted-local-e2e.ts`
- `apps/cloudflare/vitest.e2e.config.ts`
- `apps/cloudflare/package.json`
- `apps/cloudflare/test/hosted-local-*e2e.test.ts`
- `apps/cloudflare/test/helpers/hosted-local-*.ts`
- directly coupled e2e workflow/script guard tests
- directly coupled verification docs if command meaning or CI behavior changes
- `agent-docs/exec-plans/active/{2026-04-24-hosted-local-e2e-speed-truth.md,COORDINATION_LEDGER.md}`

## Out of scope

- Hosted billing behavior.
- Hosted web verification-speed work under the active `apps/web` lane.
- Production deploy scripts or live Cloudflare deploy behavior unless directly required by the local e2e contract.
- Dependency updates.

## Constraints

- Preserve unrelated dirty work in the current checkout.
- Do not expose local paths, secrets, or personal identifiers in docs, commits, logs, or examples.
- Keep the e2e lane implementation-faithful: prefer real hosted web, worker, runner, Prisma, and runtime seams over test-only bypasses when feasible.
- Keep speedups truthful by removing duplicate setup or overlapping independent work, not by deleting coverage.

## Tasks

1. Baseline current hosted local e2e failures and wall time.
2. Identify fidelity gaps in the current harness and tests.
3. Fix failures with the smallest implementation-faithful changes.
4. Reduce wall time by at least 50% and record before/after timing.
5. Run scoped verification plus required completion audits.
6. Close the plan and create a scoped commit if safe.

## Verification

- Baseline and final timed hosted e2e command(s).
- `pnpm --dir apps/cloudflare test:e2e:local`
- `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`
- `pnpm --dir apps/cloudflare test:e2e:telegram:local`
- `pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local`
- directly coupled focused Vitest guard tests
- `pnpm typecheck`

## Latest results

- Baseline: `pnpm --dir apps/cloudflare test:e2e:local` failed after 350.38s wall time.
- Current: `pnpm --dir apps/cloudflare test:e2e:local` passed after 166.37s wall time after the final orchestration edits, a 52.5% reduction from the measured baseline.
- The Linq webhook voice-memo e2e now asserts the real metadata-only local runner behavior: attachment metadata/download and inbound cleanup happen, hosted execution drains, and no assistant provider call or Linq reply is made without transcript text.
- Coverage-write added a focused orchestration proof for `apps/cloudflare/scripts/run-hosted-local-e2e.ts`, asserting the full-stack hosted local files launch in one Vitest process and cleanup still runs.
- Green checks so far:
  - `pnpm --dir apps/cloudflare test:e2e:local`
  - `pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.e2e.config.ts test/run-hosted-local-e2e.test.ts --no-coverage`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir apps/cloudflare test:node`
  - `pnpm typecheck`
  - `git diff --check`
- Coverage-write audit completed with one focused proof test.
- Required task-finish-review audit found and fixed one privacy issue in the focused proof test, avoiding assertion diffs of `process.env`.
- Narrow follow-up review confirmed no findings after the privacy fix and failure-path cleanup proof.
Completed: 2026-04-24
