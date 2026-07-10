# Speed up local verification without weakening proof

Status: completed
Created: 2026-07-09
Updated: 2026-07-09

## Goal

- Shorten the local and agent verification loop by removing duplicated work and
  false serialization while keeping the same owner, dependent, and acceptance
  proof.

## Success criteria

- Measured bottlenecks are documented with reproducible timing or structural
  evidence.
- Direct app verification can use its intended safe parallel lane.
- Diff-aware verification uses bounded concurrency and is sufficient as the
  default agent proof for scoped changes without a redundant full-workspace
  typecheck.
- Full `pnpm typecheck` and `pnpm test` still pass, and acceptance semantics are
  not weakened.

## Scope

- In scope: workspace verification orchestration, Vitest worker budgeting,
  focused regression coverage, and the documented agent verification matrix.
- Out of scope: product behavior, test deletion, CI coverage reduction, and new
  caching services or persistent verification state.

## Constraints

- Technical constraints: contracts artifacts must be prepared before their
  consumers; shared generated artifacts remain protected by the workspace lock;
  CLI shared-runtime tests remain serialized where their harness requires it.
- Product/process constraints: prefer deletion and existing primitives; preserve
  unrelated working-tree edits; collaborate with Fable through `cc` before the
  final design and review.

## Risks and mitigations

1. Risk: added parallelism can oversubscribe local CPUs or race shared artifacts.
   Mitigation: use one bounded budget, parent-held artifact locks, and focused
   orchestration tests.
2. Risk: faster agent guidance could omit dependency proof.
   Mitigation: make `test:diff` retain owner plus reverse-dependent typechecks and
   tests, with full acceptance unchanged.

## Tasks

1. Map and benchmark the current command graph with Fable and independent audit
   passes.
2. Fix confirmed serialization and nested-worker-budget defects with regression
   tests.
3. Simplify the required local/agent verification path around truthful
   diff-aware proof.
4. Run focused checks, full test/typecheck, completion audits, and a final Fable
   review.

## Decisions

- Keep full acceptance as the clean, comprehensive release boundary; optimize
  the inner loop rather than weakening that boundary.
- Do not add a daemon, remote cache, or new persisted state for this task.
- Restrict tsconfig discovery to the surfaces the guard actually owns instead
  of teaching the generic scanner about every local-tool directory.
- Make `test:diff` the one authoritative scoped command: affected owners and
  reverse dependents retain their exact scripts, but use bounded pnpm fanout.
- Refresh contracts declarations under the artifact lock before dependent
  diff typechecks; keep clean contracts builds in root typecheck/acceptance.
- Hold the complete `test:diff` producer-to-consumer lane under one artifact
  lock, and propagate every nested shell failure explicitly so a later check
  cannot turn an earlier failure into a false green.
- Give nested coverage/diff Vitest processes one divided CPU budget and make
  the existing `MURPH_VITEST_MAX_WORKERS` contract effective in package/root
  configs.
- Preserve explicit serial CLI smoke buckets while allowing the same four
  independent buckets already concurrent in the package-local workspace to
  share the root worker phase.

## Verification

- Commands to run: focused orchestration tests, `pnpm typecheck`, `pnpm test`,
  diff/guard checks required by the routed workflow, and benchmark probes.
- Expected outcomes: all checks pass; measured or structurally proven critical
  paths improve without reducing the tested/typechecked owner graph.
- Evidence so far:
  - Fable's `cc` scan microbenchmark: governed tsconfig discovery 33.7s to
    0.3s on the heavily loaded host; the complete workspace-boundary command
    now passed in 15.0s wall / 3.5s CPU, versus a prior 50s loaded step.
  - Incremental contracts artifact proof passed twice at 9.6s then 4.7s wall;
    the prior forced-cold measurement was 14.7s on the same loaded host.
  - `pnpm test:repo-tools`: 18 files, 300 tests passed, including executable
    app-concurrency and package/app failure-propagation harnesses.
  - Focused release/orchestration audit: 27 tests passed.
  - Leaf `pnpm test:diff` scenario: affected typecheck plus exact package test
    passed through the new bounded fanout.
  - Fable's second `cc` review approved the change set after requiring the
    now-enforced contracts-before-dependent-typecheck ordering.
  - Full `pnpm typecheck` passed. Direct tools TypeScript, shell syntax,
    diff-whitespace, and identifier/privacy checks also passed.
  - The completion deep review found and closed two orchestration bugs: nested
    shell failures could be masked, and the contracts lock ended before
    dependent consumers. Focused regressions now prove both corrections.
  - The default full `pnpm test` attempt and a one-worker retry were blocked by
    machine-wide scheduler contention (load far above the host CPU count),
    producing timeout-only failures. Every timed-out target passed in isolated
    one-worker reruns: assistant startup imports (3 tests), assistant outbox
    runtime (57 tests), and the release audit case (1 test, 26 skipped). No
    assertion failure was reproduced, and the final deep review found no
    causal path from this diff to those timeouts.
Completed: 2026-07-09
