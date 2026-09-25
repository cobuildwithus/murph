# Reduce checkpoint startup latency without changing typing admission

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Goal

Reduce actual processing latency, preserve canary diagnostic retention, and
remove the earlier typing-only mitigation rejected by the user.

## Scope and ownership

Use only the established `codex/typing-latency-repro` task checkout. The task
owns its prior two commits. Restore typing implementation and affected tests to
the state before the second commit, retaining its canary diagnostic changes.
PR #3599 owned a separate earlier-typing approach and was closed without merge
during this task; it was never modified.
Other local worktrees own database deadlines, callback nonce critical sections,
snapshot validation, runtime scheduling, and ingress admission. Preserve them.
No PR publication, production changes, migrations, or deployment in this task.

## Diagnosis and decisions

Production evidence is private and is not copied here. The earlier diagnosis
assigned too much of a slow checkpoint request to database work: elapsed time
before the first pool initialization is not evidence of query execution.
Existing telemetry cannot conclusively distinguish module initialization from
request-body or local signature work during that interval. Add one value-free
first-handler invocation log per route module instance; together with platform
invocation timestamps and the existing pool log it exposes that missing split.
Routine subsequent checkpoints do not gain another log.

The checkpoint route statically imports its optional post-response signal owner.
A fresh-process benchmark reproduces unnecessary initialization of the actual
Temporal and KMS dependencies. Load this owner within the existing background
task. Preserve checkpoint authority, publication ordering, wake acknowledgement,
failure handling, and typing admission. Do not remove the canonical checkpoint
barrier or duplicate the separately merged Worker startup optimization.

## Tasks and success criteria

- [x] Audit worktree heads, dirty paths, and open PR file overlap.
- [x] Remove task-owned earlier-typing changes without touching other work.
- [x] Reproduce eager SDK initialization and remove it from checkpoint import.
- [x] Verify route success, skipped wake, slow signal, failed signal and retry.
- [x] Verify restored runtime behavior and relevant typechecks.
- [x] Review all changes and retain canary proof; finish through the scoped plan commit.

## Verification

The benchmark uses the same shared dependencies with baseline/current route
sources, fresh Node processes, one discarded warmup and seven measured runs in
alternating order. It observes real SDK loading, without database or provider
credentials. This is an esbuild/Node experiment, not a production Next build or
an end-to-end Vercel latency measurement. Median route import was 229.87 ms at
baseline and 184.10 ms after the change; both SDKs were absent at current import.

Focused route/publication suites: 114 tests passed. Web typecheck initially
stopped because removing the prior entry left an empty changelog date directory;
the replacement performance entry addresses that intermediate state.
Final focused Web route/publication proof passed 114 tests. Restored runtime
runner/importer/attachment/handoff proof passed 254 tests. Changelog rendering
passed 10 tests. Web and assistant-runtime typechecks passed. A test initially
used an ES2024 promise helper outside the Web target; replacing it with the
existing deferred-promise pattern fixed the typecheck.

Focused Web ESLint passed. The benchmark sits outside the Web lint configuration;
Node syntax validation, successful benchmark execution, and the complexity guard
cover it. Logging privacy, diff whitespace, complexity and docs drift checks
passed. The unchanged latency-dashboard complexity hotspot did not grow. The
docs guard initially required an index update; the reliability owner index now
includes deferred checkpoint wake initialization.

Useful reproduction commands (from the task checkout):

```sh
mkdir -p apps/web/.runtime/tmp
git show aad1466a063b:apps/web/app/api/internal/hosted-workspace/checkpoint/route.ts > apps/web/.runtime/tmp/checkpoint-baseline.ts
node scripts/benchmark-hosted-checkpoint-startup.mjs apps/web/.runtime/tmp/checkpoint-baseline.ts
pnpm exec tsx apps/web/scripts/run-hosted-web-vitest.mts apps/web/test/hosted-runtime-internal-routes.test.ts apps/web/test/hosted-workspace-runtime-publication.test.ts
pnpm --dir apps/web typecheck:prepared
pnpm --dir packages/assistant-runtime typecheck
```

The prior canary commit remains unchanged: its five PostgreSQL cascade/deletion
race cases, account cleanup tests, and empty-database migration-chain proof remain
applicable. This follow-up did not rerun or modify that migration. Parent review
confirmed ordinary deletion still purges diagnostics, both trace creators retain
the suspension fence, and canary cleanup retries retain the settled log no-op.
Open PR overlaps are shared docs/schema files in unrelated sections; the new
checkpoint route change has no open-PR source overlap. All edits stayed in the
owned checkout. The runtime source now exactly matches the pre-mitigation
revision. No PR was opened, no branch pushed, and no deployment performed.

## Product UX and changelog

The earlier typing change is removed. Follow-up processing benefits when a
checkpoint route initializes without needing its optional background signal.
Ready: future/due wake, signal failure/retry, no-wake, attachment handoff, and
ordinary conversation journeys pass.
The performance entry describes reduced startup work without claiming a fixed
response deadline. Assistant prompts, provider input, and tools are unchanged.

## Limits

The local import result does not reproduce the full historical pre-database
stall or the platform interval before Worker JavaScript began. Keep those
uncertainties explicit. The previous canary retention migration and its staged
writer-first deployment requirement remain unchanged and undeployed.
Completed: 2026-09-20
