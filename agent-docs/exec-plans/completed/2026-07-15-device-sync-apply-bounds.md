# Bound hosted device-sync runtime apply work

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Close security finding `cand-R0097-01` by preventing one authenticated hosted
  device-sync apply request from amplifying into unbounded concurrent database
  transactions, without changing device-sync ownership or adding infrastructure.

## Success criteria

- The shared runtime-apply contract rejects an oversized update batch before web
  opens any connection mutation transaction.
- The trusted runtime splits legitimate larger results into bounded sequential
  requests.
- Web applies accepted updates sequentially while preserving the current
  per-connection lock, version checks, response order, and independent transaction
  semantics.
- Focused tests, truthful diff-aware verification, required completion audits,
  parent final review, ReviewGPT, and CI have no unresolved actionable findings.

## Scope

- In scope: the shared device-sync apply contract, hosted runtime reconciliation
  producer, web-owned apply implementation, focused tests, and the narrow durable
  device-sync owner documentation needed to record the bound.
- Out of scope: bulk SQL, queues, leases, schema changes, provider behavior,
  connection ownership, and unrelated device-sync resource-window findings.

## Constraints

- Keep `apps/web` as the canonical hosted device-sync control-plane owner.
- Preserve each connection's existing transaction and stale-version handling.
- Do not introduce a concurrency helper, dependency, persisted state, or new
  retry/reconciliation mechanism.
- Preserve unrelated work in every checkout and do not interrupt other sessions.

## Risks and mitigations

1. Risk: a hard admission limit rejects a legitimate member with many connections.
   Mitigation: share the limit with the runtime producer and split its output into
   sequential bounded requests.
2. Risk: sequential application changes atomicity or result ordering.
   Mitigation: the current path already uses one independent transaction per
   connection; retain input-order output and prove it directly.
3. Risk: a new protocol assumption breaks during web/runner deploy skew.
   Mitigation: new runners remain compatible with old web, and new web accepts all
   batches emitted by the new runner; document and use runner-before-web rollout.

## Tasks

1. Define and enforce the shared update-count bound.
2. Split runtime write-back into sequential bounded requests.
3. Replace the web apply `Promise.all` fan-out with sequential application.
4. Add focused contract, runtime, and web concurrency proof.
5. Run verification, completion audits, final review, commit, PR, ReviewGPT, and CI.

## Decisions

- Use a shared numeric admission constant rather than deriving authority from
  request size or adding a second state owner.
- Apply web updates sequentially because normal batches are one entry per changed
  connection and are expected to be small; optimize only if measured later.

## Verification

- `pnpm --dir packages/device-syncd test -- hosted-runtime.test.ts` passed
  package-wide: 42 files, 822 tests.
- `pnpm --dir packages/assistant-runtime test
  test/hosted-device-sync-runtime.test.ts` passed: 1 file, 72 tests.
- `pnpm --dir apps/web test:prepared
  apps/web/test/device-sync-hosted-runtime-authority.test.ts` passed: 1 file,
  38 tests.
- `pnpm --dir apps/web typecheck` passed, including generated health-commons and
  Prisma artifacts and the shared-host TypeScript checker lane.
- Diff-aware verification passed syntax, architecture, security/logging, dependency,
  workspace-boundary, cycle, and all affected package typechecks. Its broad
  reverse-dependent test graph was stopped after the unrelated
  `assistant-engine` warm-Codex suite entered shared-state contention and reported
  144 failures; no changed file is in that package, and all three owner-level
  suites pass independently.
- Required coverage-write audit made no edits and independently reran the three
  focused suites. It found the proof sufficient at the shared contract, runtime
  batching, and web mutation boundaries.
- `git diff --check` passed.
Completed: 2026-07-15
