# Hosted mailbox Temporal hardening fixes

Status: active
Created: 2026-05-21
Updated: 2026-05-27

## Goal

- Close the final hosted Temporal hardening gaps from the current audit:
  mailbox append signals must create the hosted workspace for active users,
  explicit workspace auto-creation must stay active-member gated, account
  deletion should terminate the workflow before web row deletion, non-retryable
  Activity failures should stop 30s workflow retries, duplicated Activity
  env integer parsing should reject malformed suffixes, accepted runtime wake
  counting should be explicit, and device-sync recovery should stop self-waking
  the same active runtime after a bounded number of accepted wakes.

## Success criteria

- Mailbox append signal paths pass through workspace auto-creation before
  Temporal signal-with-start.
- Active members still get workspace auto-creation and Temporal signal-with-start.
- Missing, deleted, inactive, or suspended members fail before workspace upsert
  or Temporal signaling whenever a path requests workspace auto-creation.
- Hosted-local E2E covers an active member with no pre-existing workspace being
  awakened through a mailbox append signal.
- Account deletion makes a best-effort Temporal termination before the Prisma
  delete transaction and again after Cloudflare cleanup.
- Non-retryable Activity failures record compact error metadata and wait for a
  signal instead of retrying every 30 seconds, with Temporal patching guarding
  existing histories.
- Activity HTTP env integer parsing accepts only full positive digit strings.
- The first accepted wake for a runtime records a same-runtime wake count of
  `1` for new histories while pre-patch histories keep replay-compatible count
  behavior.
- Device-sync recovery stops preserving its explicit recovery flag after
  repeated accepted wakes for the same runtime instead of looping on the same
  active runtime.
- Required verification and completion workflow checks run, or any unrelated
  blockers are recorded precisely.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-orchestration/signal-runtime.ts`
  - `apps/web/src/testing.ts`
  - `apps/web/src/lib/hosted-privacy/account-data-service.ts`
  - `apps/web/test/hosted-orchestration-signal-runtime.test.ts`
  - `apps/web/test/hosted-account-data-service.test.ts`
  - `apps/cloudflare/test/hosted-local-temporal-orchestration-e2e.test.ts`
  - `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
  - `packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts`
  - `packages/hosted-orchestrator-temporal/src/activities/http-client.ts`
  - `packages/hosted-orchestrator-temporal/test/ensure-runtime-processing.test.ts`
  - `packages/hosted-orchestrator-temporal/test/read-runtime-demand.test.ts`
  - `agent-docs/references/hosted-temporal-orchestration.md`
  - `agent-docs/index.md`
- Out of scope:
  - Temporal workflow command ordering.
  - Cloudflare execution adapter behavior.
  - Cloudflare execution adapter routing.
  - Shared Temporal env parser dedup work tracked by the separate active row.
  - Broad retry policy redesign beyond non-retryable Activity failure handling.

## Constraints

- Technical constraints:
  - Keep Temporal signals pointer-only.
  - Do not create new persisted state.
  - Reuse existing hosted member entitlement helpers.
  - Guard workflow wait-shape changes with Temporal patching.
- Product/process constraints:
  - Preserve unrelated dirty worktree edits.
  - Do not expose local identifiers, raw user data, secrets, or paths in code,
    docs, test fixtures, logs, commits, or handoff.

## Risks and mitigations

1. Risk: Blocking legitimate activation, mailbox, or manual wake paths.
   Mitigation: Reuse `hasHostedMemberActiveAccess` and keep active-member tests
   around workspace auto-creation plus `signalWithStart`.
2. Risk: Reintroducing post-deletion workspace rows through helper seams.
   Mitigation: Place the guard immediately before `ensureHostedWorkspace` in
   the shared signal helper path used by workspace-creating signals.
3. Risk: Breaking replay for existing workflow histories by changing failed
   Activity retry timers.
   Mitigation: gate the signal-only non-retryable wait with a Temporal
   `patched()` marker and keep old histories on the previous 30s timer.

## Tasks

1. Add active-member access guard before workspace auto-creation.
2. Make mailbox append signal paths request workspace auto-creation.
3. Add focused tests for active, missing, inactive/suspended, and mailbox
   workspace behavior.
4. Add hosted-local E2E coverage for mailbox append signaling an active member
   with no pre-existing workspace.
5. Move first account-deletion Temporal termination before the Prisma delete.
6. Make non-retryable Activity failures wait for a signal at the workflow layer
   with Temporal patching.
7. Make Activity HTTP env positive integer parsing strict.
8. Fix accepted runtime wake count semantics and bound same-runtime device-sync
   recovery wake loops.
9. Document bounded device-sync accepted-wake behavior in the hosted Temporal
   ADR.
10. Run focused hosted orchestration tests and required broader verification.
11. Run completion audits required by the high-risk repo workflow.
12. Inspect diff for privacy leakage, close the plan, and create a scoped commit
   if safe.

## Decisions

- Treat this as a high-risk scoped hosted control-plane change because it gates
  state recreation and Temporal startup after deletion.
- Keep the user-facing error generic and metadata-free.
- Keep the demand endpoint read-model oriented; fix the mailbox workspace gap
  in the signal path instead of creating workspace rows during demand reads.
- Use a Temporal patch marker for the non-retryable failure wait change so old
  histories continue to replay against the previous timer behavior until they
  drain or continue as new.
- Use a Temporal patch marker for same-runtime wake count semantics and the
  device-sync recovery wake cap so old histories keep their previous timer
  command shape.

## Verification

- Commands to run:
  - `pnpm exec vitest run apps/web/test/hosted-orchestration-signal-runtime.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `pnpm exec vitest run apps/web/test/hosted-orchestration-demand.test.ts apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-orchestration-workflow-termination.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `pnpm exec vitest run packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts packages/hosted-orchestrator-temporal/test/worker.test.ts packages/hosted-orchestrator-temporal/test/ensure-runtime-processing.test.ts packages/hosted-orchestrator-temporal/test/read-runtime-demand.test.ts --config packages/hosted-orchestrator-temporal/vitest.config.ts --no-coverage`
  - `pnpm hosted-local e2e temporal-orchestration`
  - `pnpm typecheck`
  - `pnpm verify:acceptance`
- Expected outcomes:
  - Focused tests pass.
  - Typecheck and acceptance pass, or any failure is proven unrelated to this
    scoped diff.
- Results so far:
  - PASS: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-orchestration-signal-runtime.test.ts apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-orchestration-workflow-termination.test.ts`
  - PASS: `pnpm exec vitest run --config vitest.config.ts --no-coverage test/hosted-user-runtime-workflow.test.ts test/worker.test.ts test/ensure-runtime-processing.test.ts test/read-runtime-demand.test.ts`
  - PASS: `pnpm --dir packages/hosted-orchestrator-temporal exec vitest run --config vitest.config.ts --no-coverage test/hosted-user-runtime-workflow.test.ts`
  - PASS: `pnpm --dir packages/hosted-orchestrator-temporal typecheck`
  - PASS: `pnpm --dir packages/hosted-orchestrator-temporal exec vitest run --config vitest.config.ts --no-coverage test/hosted-user-runtime-workflow.test.ts test/worker.test.ts test/ensure-runtime-processing.test.ts test/read-runtime-demand.test.ts`
  - PASS: `bash scripts/workspace-verify.sh test:diff packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts agent-docs/references/hosted-temporal-orchestration.md agent-docs/index.md`
  - PASS: `pnpm test:smoke`
  - PASS: `pnpm docs:drift`
  - PASS: `git diff --check`
  - PASS: security/privacy review subagent; no findings.
  - PASS: coverage-write subagent added an `already_running` first accepted
    wake regression test and the rerun checks above passed.
  - PASS: final task-finish review subagent; no findings.
  - BLOCKED: `pnpm typecheck` failed in unrelated active query/vault-usecases
    work. The latest failure is `packages/vault-usecases/src/query-runtime.ts`
    importing projected wearable summary type names that are not exported by
    `@murphai/query`. Earlier attempts failed on active `packages/query`
    projection refactor symbols. This task did not touch those files.
  - BLOCKED: `pnpm verify:acceptance` fails at the same workspace typecheck
    stage for the unrelated query/vault-usecases exported wearable type drift.
  - PENDING: `pnpm hosted-local e2e temporal-orchestration` exited before the
    test body while waiting on shared workspace artifact locks from concurrent
    verification work.
