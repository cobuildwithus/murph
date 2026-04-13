# Land target-area review patch

Status: completed
Created: 2026-04-13
Updated: 2026-04-13

## Goal

- Land the supplied review patch for the assistant/operator-config/assistant-runtime seam against the current repo snapshot without broadening scope.

## Success criteria

- The targeted secret-handling, session-secret merge, hosted-usage parsing, and shared event-source changes are present and consistent with current code.
- Required scoped verification passes or the closest truthful fallback run and results are recorded.
- Required completion-workflow audits run, any findings are resolved, and the task is committed without touching unrelated dirty files.

## Scope

- In scope:
- Files under `packages/assistant-engine/**`, `packages/operator-config/**`, and `packages/assistant-runtime/**` needed to land the supplied patch intent.
- Focused tests for the changed behaviors.
- Out of scope:
- Persisted-shape/version changes for the assistant secret sidecar field naming.
- Unrelated pre-existing `apps/web/**`, `package.json`, and `pnpm-lock.yaml` worktree edits.

## Constraints

- Technical constraints:
- Current repo snapshot differs from the supplied patch, so apply intent manually where hunks drift.
- Do not expose secret material or write inline secret-bearing persisted session state.
- Product/process constraints:
- Follow the high-risk repo-change workflow, including ledger use, required audits, verification, and a scoped commit.

## Risks and mitigations

1. Risk: Patch drift could tempt broad refactors or accidental behavior changes outside the intended seam.
   Mitigation: Reconstruct only the supplied behavioral intent, inspect each touched owner directly, and keep verification focused on the exact seam.

2. Risk: Dirty unrelated worktree files could be swept into verification fallout or commit scope.
   Mitigation: Avoid those files, commit only touched paths, and call out any unrelated red checks explicitly if encountered.

## Tasks

1. Inspect the patch intent against the current snapshot and identify drift.
2. Apply the intended source and test updates within the assistant/operator-config/runtime seam.
3. Run truthful scoped verification plus direct scenario proof for the touched behavior.
4. Run required coverage-write and final-review audits, address findings, and re-run affected checks.
5. Finish the task with a scoped commit through the repo workflow.

## Decisions

- Use a plan despite the patch origin because the change is high-risk and spans multiple files/packages.
- Treat the supplied patch as behavioral intent, not as overwrite authority, because at least one hunk already drifts from the current snapshot.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/redaction.ts packages/assistant-engine/src/assistant/state-secrets.ts packages/assistant-engine/src/assistant-cli-tools/capability-definitions.ts packages/assistant-engine/test/assistant/state-secrets.test.ts packages/assistant-engine/test/assistant-cli-tools/capability-definitions.test.ts packages/assistant-runtime/src/hosted-runtime/platform.ts packages/assistant-runtime/test/hosted-runtime/platform.test.ts packages/operator-config/src/assistant/redaction.ts packages/operator-config/src/assistant-cli-contracts.ts packages/operator-config/test/assistant/assistant-cli-contracts.test.ts packages/operator-config/test/assistant/redaction.test.ts`
- Expected outcomes:
- Typecheck passes.
- Diff-scoped verification truthfully covers the touched owners, or if it cannot run due to environment issues those failures are captured precisely.
Completed: 2026-04-13
