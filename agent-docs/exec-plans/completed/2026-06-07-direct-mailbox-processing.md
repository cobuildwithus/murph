# Direct Temporal mailbox processing

Status: completed
Created: 2026-06-07
Updated: 2026-06-07

## Goal

- Extract the hosted Temporal ensure-processing block into one helper and let committed mailbox pointers call ensure-processing directly without first reading web demand.

## Success criteria

- Existing run-demand execution behavior is shared through one helper.
- When `latestMailboxPointer` is present and the patch marker is enabled, the workflow executes runtime processing with `{ reason: "nudge", source: "mailbox_backlog" }` without calling `readRuntimeDemand`.
- Pre-patch behavior still reads demand for replay compatibility.
- Retry-later and accepted-processing paths preserve mailbox pointer/flag semantics.
- Required Temporal workflow tests and typecheck pass.

## Scope

- In scope:
  - `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
  - `packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts`
- Out of scope:
  - Web demand route changes.
  - Cloudflare execution adapter changes.
  - New signal shape, durable state, or scheduling behavior.

## Constraints

- Use a Temporal patch marker for replay safety.
- Keep Workflow history pointer-only.
- Do not remove legacy direct browser-vault or device-sync compatibility in this change.
- Preserve unrelated working-tree edits.

## Risks and mitigations

1. Risk: Reordering command-producing Temporal APIs can break replay.
   Mitigation: Gate the direct mailbox path behind `patched("hosted-user-runtime-direct-mailbox-processing-v1")` and keep pre-patch demand-read behavior covered by tests.
2. Risk: Direct mailbox processing might clear mailbox work on retry-later.
   Mitigation: Add a retry-later test that verifies the pointer remains pending.

## Tasks

1. Add direct-mailbox patch marker and runtime seam.
2. Extract shared ensure-processing helper.
3. Add direct mailbox execution path before demand read.
4. Update workflow tests for direct and pre-patch paths.
5. Run verification.
6. Commit and open PR.

## Decisions

- Direct mailbox processing is keyed to `latestMailboxPointer !== null`, not `mailboxSignalCount`, so count-only carry-forward state does not become runnable work.

## Verification

- Commands run:
  - `pnpm --filter @murphai/hosted-orchestrator-temporal test -- hosted-user-runtime-workflow.test.ts`
  - `pnpm typecheck`
  - `pnpm test:diff packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts`
- Outcome:
  - All passed.
Completed: 2026-06-07
