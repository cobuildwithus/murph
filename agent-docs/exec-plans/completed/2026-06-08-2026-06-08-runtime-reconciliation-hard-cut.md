# PR65+PR66 runtime reconciliation hard cut

Status: completed
Created: 2026-06-08
Updated: 2026-06-08

## Goal

- Land the PR65+PR66 hard cut that removes product demand decisions from hosted runtime orchestration. Web exposes source-less reconciliation facts, Temporal owns sleeps/retries over those facts, Cloudflare remains the thin execution adapter, and mailbox signals carry only durable mailbox pointers.

## Success criteria

- Shared hosted orchestration contracts and parsers no longer expose the old demand contract, legacy direct wake signals, or mailbox signal source metadata.
- `apps/web` replaces `/demand` with `/reconciliation-facts`, preserving web-owned product gates without returning product run decisions.
- `packages/hosted-orchestrator-temporal` uses `readRuntimeReconciliationFacts`, hard-cuts legacy signal/source handling, and re-reads facts after timers before ensuring `alarm`.
- Tests cover parser rejection, web facts behavior, signal payload shape, activity routing, and workflow loop behavior.
- Required verification, completion audits, scoped commit, push, and PR are complete.

## Scope

- In scope:
  - `packages/hosted-execution` orchestration contracts, paths, and parsers.
  - `apps/web` hosted orchestration route/service/signal producers and tests.
  - `packages/hosted-orchestrator-temporal` activity, workflow, worker docs, smoke/tests.
  - Durable docs that describe the hosted orchestration hard cut and coordinated deployment requirement.
- Out of scope:
  - Removing `reason` from Cloudflare `ensure-processing`.
  - Adding recurring schedulers, Vercel cron, or new mailbox recovery services.
  - Running production Temporal termination/reseed commands.

## Constraints

- Technical constraints:
  - This is intentionally not replay-compatible for existing `hosted-user-runtime:*` histories. Deployment must stop old workers, terminate old workflows, deploy web and Temporal together, then reseed workflows.
  - Temporal workflow history must stay pointer-only and free of raw payloads, prompts, transcripts, provider data, secrets, or local paths.
  - Web may block work for usage/product gates, but it must not return product run reasons/sources to Temporal.
  - Fresh mailbox signals should ensure runtime processing directly before any cold reconciliation facts read.
- Product/process constraints:
  - Preserve foreground conversation priority.
  - Keep architecture simple: no compatibility `/demand` route if this is the hard cut.
  - Preserve unrelated active plan/worktree edits.

## Risks and mitigations

1. Risk: New worker replays old histories after demand activities/signals are deleted.
   Mitigation: Document coordinated cutover and make the PR explicitly require workflow termination/reseed before worker restart.
2. Risk: Facts endpoint leaks product demand decisions back into Temporal.
   Mitigation: Parser rejects demand-shaped fields; tests assert facts are only `blocked`, `mailboxLag`, and `workspace`.
3. Risk: Usage denial causes repeated cold runner wakes.
   Mitigation: Web facts gate conversation lag, true manual system lag, and due model-capable wakes before Temporal calls Cloudflare.
4. Risk: Timer wake over-runs canceled workspace wake.
   Mitigation: Workflow re-reads reconciliation facts after timer expiry before ensuring `alarm`.

## Tasks

1. Map current demand, signal, activity, and workflow call paths.
2. Replace shared contracts/parsers/route builders with reconciliation facts.
3. Replace web demand route/service/tests and remove signal `source`.
4. Replace Temporal demand activity and hard-cut workflow loop.
5. Update docs, smoke helpers, and guard tests.
6. Run targeted verification, required completion audits, final commit, push, and PR creation.

## Decisions

- Branch from `origin/main`; PR64 head is already merged into `origin/main`.
- Use `HOSTED_RUNTIME_RECONCILIATION_FACTS_TIMEOUT_MS` as the primary timeout
  env and keep `HOSTED_RUNTIME_DEMAND_TIMEOUT_MS` as a deprecated hard-cut
  fallback.

## Verification

- Completed:
  - `pnpm --dir packages/hosted-execution test`
  - `pnpm --dir packages/hosted-orchestrator-temporal test`
  - Focused web reconciliation/mailbox/status/signal/producer route tests.
  - Focused Cloudflare hosted route/runner-state tests.
  - `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/check-hosted-temporal-orchestration-guards.test.ts`
  - `pnpm hosted-temporal:guard`
  - Strict stale-symbol grep for deleted demand/signal/source symbols.
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm verify:acceptance`
- Outcome: all completed checks passed.
Completed: 2026-06-08
