# Hosted runtime processing wake fix and observability

Status: completed
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Land the hosted runtime wake fix plus the minimal observability slice needed
  to debug orchestration state without adding a second scheduler, dashboard, or
  broad tracing framework.

## Success criteria

- `ensureCloudflareExecution` is recontracted/renamed to short-lived
  `ensureRuntimeProcessing` at the Temporal activity boundary.
- Cloudflare returns quickly after accepting a runtime start, active wake, or
  pending wake while the child is not wake-ready.
- Temporal waits signal-interruptibly on recommended runtime rechecks so fresh
  mailbox signals can immediately drive another processing attempt.
- Workflow status exposes scalar wait/retry/loop diagnostics.
- Web logs one structured demand-decision record per demand calculation.
- The two Temporal activities use a small shared observation wrapper.
- Runner write-fence status preserves the active fence reason.
- One internal per-user status endpoint composes Temporal status, current web
  demand, and Cloudflare runner status.
- Focused tests, typecheck/test coverage, required audit subagents, and the
  scoped finish-task commit complete.

## Scope

- In scope:
  - Hosted Temporal workflow/activity contract and tests.
  - Cloudflare ensure-processing adapter and runner state/status tests.
  - Web hosted-demand observability and internal orchestration status route.
  - Shared hosted orchestration contracts/parsers and durable docs that describe
    the changed runtime contract.
- Out of scope:
  - OpenTelemetry, metrics frameworks, Temporal Search Attributes, dashboards,
    or event-history payload expansion.
  - A webhook-to-Cloudflare direct wake path or any second wake authority.

## Constraints

- Technical constraints:
  - Temporal workflow state must remain pointer-only and deterministic.
  - Any new workflow wait must be signal-interruptible.
  - Logs must stay metadata-only and must not include payloads, prompts,
    transcripts, secrets, local paths, or direct identifiers beyond existing
    opaque hosted user ids.
  - Cloudflare Durable Object storage remains execution coordination only.
- Product/process constraints:
  - Preserve unrelated dirty work and overlapping active ledger rows.
  - Use subagents for the requested parallel observability implementation where
    write scopes can stay disjoint.
  - Required completion audits apply because this touches observability, runtime
    trust boundaries, and external/internal control routes.

## Risks and mitigations

1. Risk: Temporal replay break from changed awaited command ordering.
   Mitigation: keep awaited call order stable where possible, use
   signal-aware `condition()` waits, and add replay/versioning evidence if a
   command-ordering change becomes unavoidable.
2. Risk: Observability leaks sensitive hosted runtime data.
   Mitigation: only log scalar metadata and bounded enum/code fields; tests and
   security review cover redaction and shape.
3. Risk: Status endpoint accidentally becomes a control plane.
   Mitigation: route stays internal/read-only and composes existing primitives
   without new mutation authority.

## Tasks

1. Done: Map current contracts and overlapping active work.
2. Done: Implement runtime-processing contract and signal-interruptible
   recheck.
3. Done: Add observability fields, logs, wrapper, write-fence reason
   persistence, and internal composed status route.
4. Done: Update focused tests and durable runtime docs.
5. Done: Run verification.
6. Done: Handoff without commit because overlapping pre-existing dirty files in
   active hosted-runtime and verification rows block a safe scoped commit.

## Decisions

- Use scalar status fields and structured logs only; no event arrays or generic
  tracing framework.
- Temporal remains the only orchestration decision authority.

## Verification

- Commands run:
  - `pnpm --filter @murphai/hosted-execution typecheck`
  - `pnpm --filter @murphai/hosted-orchestrator-temporal typecheck`
  - `pnpm --filter @murphai/cloudflare-runner typecheck`
  - `pnpm --filter @murphai/hosted-web typecheck:prepared`
  - `pnpm --filter @murphai/hosted-execution test -- hosted-orchestration-control temporal-env`
  - `pnpm --filter @murphai/hosted-orchestrator-temporal test -- hosted-user-runtime-workflow ensure-cloudflare-execution workflow-entrypoint workflow-contracts temporal-env signal-hosted-user-runtime`
  - `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/runner-state-store-wake-backoff.test.ts apps/cloudflare/test/runner-state-store.bundle-slots.test.ts --no-coverage`
  - `pnpm --dir . exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-orchestration-demand.test.ts apps/web/test/hosted-orchestration-status.test.ts apps/web/test/hosted-orchestration-signal-runtime.test.ts apps/web/test/hosted-orchestration-temporal-client.test.ts --no-coverage`
  - `pnpm --dir packages/hosted-orchestrator-temporal exec vitest run --config vitest.config.ts --no-coverage test/hosted-user-runtime-workflow.test.ts`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/user-runner-alarm.test.ts test/runner-container.test.ts test/container-entrypoint.test.ts test/index.test.ts`
  - `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-orchestration-control.test.ts test/temporal-env.test.ts`
  - `pnpm --dir packages/cloudflare-hosted-control exec vitest run --config vitest.config.ts --no-coverage test/routes.test.ts`
  - `pnpm --dir packages/hosted-orchestrator-temporal exec vitest run --config vitest.config.ts --no-coverage test/hosted-user-runtime-workflow.test.ts test/ensure-cloudflare-execution.test.ts test/temporal-env.test.ts test/signal-hosted-user-runtime.test.ts test/workflow-entrypoint.test.ts`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-orchestration-demand.test.ts apps/web/test/hosted-orchestration-status.test.ts apps/web/test/hosted-orchestration-signal-runtime.test.ts apps/web/test/hosted-orchestration-temporal-client.test.ts`
  - `pnpm typecheck`
  - `pnpm test:diff` under the workspace artifact lock
  - `git diff --check`
  - changed-file scan for local paths/user identifiers
- Outcomes:
  - All focused hosted-runtime checks passed.
  - Root typecheck passed.
  - The first `pnpm test:diff` attempt hit a transient standalone
    `packages/vault-usecases` typecheck failure while resolving
    `@murphai/contracts`; after serializing behind the workspace artifact lock,
    `pnpm test:diff` passed end to end.
  - Diff whitespace and identifier/path scans passed.

## Handoff

- Commit intentionally left open: overlapping dirty work in active hosted
  runtime, Temporal, Cloudflare, web, and verification rows prevents a safe
  scoped commit without sweeping in unrelated edits.
Completed: 2026-05-21
