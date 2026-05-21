# Mailbox lag control coalescing

Status: completed
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Prevent the automated hosted mailbox lag sweeper from accumulating duplicate
  `runtime.mailbox-lag-observed` control rows while an earlier lag-observed
  control row is still pending import.

## Success criteria

- Manual, browser-vault refresh, and device-sync recovery control requests keep
  their existing one-row-per-request behavior.
- `runtime.mailbox-lag-observed` skips appending a new control row when the
  first pending system mailbox item is already `runtime.mailbox-lag-observed`.
- The skipped case still signals Temporal with the existing pending mailbox
  pointer so the wake hint is not lost.
- Focused tests cover both the coalesced and non-coalesced paths.

## Scope

- In scope:
  - Hosted web runtime signal helper logic.
  - Hosted mailbox pending-system read helper shape if needed.
  - Focused hosted orchestration signal tests.
- Out of scope:
  - Changing control wake event-id format globally.
  - Changing manual or other explicit user-triggered request semantics.
  - New scheduler or retry state.

## Constraints

- Preserve existing random event ids for normal control requests.
- Preserve pointer-only Temporal signals and durable mailbox demand truth.
- Do not expose user identifiers, mailbox payloads, secrets, or local paths in
  tests, docs, logs, or final output.
- Preserve unrelated dirty worktree edits.

## Verification

- Passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts hosted-orchestration-signal-runtime.test.ts --reporter=dot`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-orchestration/signal-runtime.ts apps/web/src/lib/hosted-mailbox/store.ts apps/web/test/hosted-orchestration-signal-runtime.test.ts agent-docs/exec-plans/active/2026-05-21-mailbox-lag-control-coalescing.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - `git diff --check` scoped to this task's touched files
  - scoped privacy scan for local paths, bearer/authorization material, and
    raw message/header marker strings
Completed: 2026-05-21
