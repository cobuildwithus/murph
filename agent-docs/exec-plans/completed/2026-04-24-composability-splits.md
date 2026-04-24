# Land high-value composability splits

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Land the requested high-value composability splits by moving stable helper clusters out of oversized orchestration files while preserving current behavior and public entrypoints.

## Success criteria

- Existing public exports and callers continue to compile.
- Each split keeps behavior-preserving boundaries: orchestration files stay as facades, new modules own concrete helper clusters, and no new generic utility buckets are introduced.
- Current dirty-tree work is preserved; overlapping target files are edited additively and only where needed for the requested extractions.
- Required verification and completion audit passes run, or any pre-existing blockers are recorded with exact commands and targets.

## Scope

- In scope:
  - Requested splits in `apps/cloudflare/src/user-runner.ts`, `packages/assistant-engine/src/assistant/cron.ts`, `apps/web/src/lib/health-commons/experiment-detail.ts`, `packages/device-syncd/src/store.ts`, `packages/assistant-engine/src/assistant-codex.ts`, `packages/assistant-engine/src/assistant/provider-turn-runner.ts`, `packages/core/src/domains/events.ts`, `packages/core/src/vault-sync.ts`, and `packages/assistant-engine/src/model-harness.ts`.
  - Directly required imports, re-exports, and focused tests/type fixes caused by those moves.
- Out of scope:
  - Behavior changes to hosted execution, cron semantics, vault writes, device sync persistence, Codex execution, Health Commons content, or assistant provider failover.
  - Dependency changes, schema changes, generated catalog/content updates, and broad API redesign.

## Constraints

- Technical constraints:
  - Preserve package boundary rules and keep sibling package imports through public entrypoints.
  - Do not introduce compatibility shims beyond local facades needed to preserve existing public exports.
  - Do not use `as any` or broad assertion casts to silence type errors.
- Product/process constraints:
  - Preserve unrelated dirty-tree edits and active lanes in the coordination ledger.
  - Use GPT-5.5 xhigh worker subagents for independent split work as requested.
  - Keep privacy-sensitive identifiers out of files, commits, logs, examples, and handoff text.

## Risks and mitigations

1. Risk: Several requested target files already have active dirty work in the shared checkout.
   Mitigation: Split worker ownership by file/module cluster, instruct workers to preserve current edits, and integrate only narrow behavior-preserving moves.
2. Risk: Broad extraction can break implicit private helper ordering or circular imports.
   Mitigation: Move concrete clusters behind explicit imports, keep facades as orchestration shells, and run typecheck plus targeted owner tests.
3. Risk: Completion verification may be blocked by unrelated active branch failures.
   Mitigation: Run the required commands, capture failing targets, and distinguish current-diff failures from pre-existing branch churn.

## Tasks

1. Delegate independent split slices to GPT-5.5 xhigh workers with disjoint write scopes.
2. Review and integrate worker changes, resolving import/export/type issues without broad rewrites.
3. Run verification and completion workflow audit passes.
4. Close the plan and commit the scoped diff when safe; otherwise archive the plan and report overlapping blockers.

## Decisions

- Treat this as a high-risk cross-cutting refactor because it touches hosted execution, cron/retry paths, device-sync persistence, assistant provider execution, core vault/event logic, and app-facing Health Commons projection code.
- Keep all requested original files as compatibility facades/orchestration shells rather than moving public entrypoints.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff <touched paths...>` or `pnpm verify:acceptance` when the diff-aware lane cannot truthfully cover the broad app/package set.
  - Focused owner tests as needed for any extraction-induced failures.
- Expected outcomes:
  - Typecheck and relevant tests pass, or failures are credibly identified as unrelated pre-existing blockers in the active dirty tree.
Completed: 2026-04-24
