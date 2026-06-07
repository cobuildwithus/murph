# Browser vault refresh intent from runtime-control mailbox

Status: completed
Created: 2026-06-07
Updated: 2026-06-07

## Goal

- Land the PR 2 patch so a processed `runtime.browser-vault-refresh-requested` system mailbox item marks browser-vault replica refresh intent inside `packages/assistant-runtime`.

## Success criteria

- The assistant phase returns a local `browserVaultReplicaRefreshRequested` marker for processed browser-vault refresh control rows.
- Fresh conversation input still bypasses system mailbox maintenance.
- Runtime browser-vault refresh maintenance treats the marker as a force refresh request without new durable state or scheduler ownership.
- Focused assistant-runtime test, typecheck, and required workflow checks pass or any unrelated blocker is documented.

## Scope

- In scope:
  - `packages/assistant-runtime` hosted runtime and assistant-phase code.
  - Focused tests for browser-vault refresh control-row propagation and foreground priority.
- Out of scope:
  - Temporal, Cloudflare, and web contract changes.
  - New durable state, queues, or schedulers.

## Constraints

- Technical constraints:
  - Preserve foreground conversation priority over browser-vault refresh work.
  - Keep browser-vault refresh behind existing runtime wake/abort/timeout behavior.
  - Do not add new persisted state.
- Product/process constraints:
  - Preserve unrelated working-tree edits.
  - Keep identifiers and local paths out of committed artifacts.

## Risks and mitigations

1. Risk: Browser-vault refresh control rows could accidentally run before fresh user input.
   Mitigation: Keep existing system-mailbox maintenance gate and add a regression test for fresh input.
2. Risk: Refresh intent could be lost when assistant/system mailbox results merge.
   Mitigation: OR the result marker through merge paths and exercise the processed control-row result.

## Tasks

1. Done: Add result marker type and propagation through assistant phase merge/system mailbox preparation.
2. Done: Record the marker in the hosted runtime foreground pass and force browser-vault maintenance from it.
3. Done: Add focused regression tests, including entrypoint-level force-refresh proof.
4. Done: Run verification and completion audits.
5. Next: Commit through `scripts/finish-task`.

## Decisions

- Keep the marker invocation-local only; no durable state or cross-service contract changes.

## Verification

- Commands to run:
  - `pnpm --filter @murphai/assistant-runtime test -- hosted-runtime-workspace-assistant-phase.test.ts`
  - `pnpm --filter @murphai/assistant-runtime test -- hosted-runtime-workspace-entrypoint.test.ts`
  - `pnpm typecheck`
  - `pnpm test:diff packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- Expected outcomes:
  - Passed.

## Audit outcomes

- `security-privacy-review`: no medium-or-higher findings.
- `coverage-write`: accepted missing runtime-level proof; added focused entrypoint test.
- `deep-review`: no production-breaking bugs found.
- `task-finish-review`: accepted missing runtime-level proof; fixed by focused entrypoint test.
Completed: 2026-06-07
