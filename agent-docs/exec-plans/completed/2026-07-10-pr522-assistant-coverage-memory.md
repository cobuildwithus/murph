# PR 522 Assistant Coverage Memory

## Goal

Make the assistant-engine release coverage check complete reliably after two
same-head CI runs exhausted the default V8 heap after all package tests passed.

## Constraints

- Keep the change scoped to CI verification; do not alter product behavior or
  weaken coverage.
- Preserve the existing serialized CI test behavior and package shard layout.
- Increase memory only for the assistant-engine coverage command.
- Verify the exact CI-mode command locally before pushing.

## Working Set

- `.github/workflows/host-support.yml`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Verification Plan

- Run the assistant-engine coverage command with CI-mode concurrency and the
  scoped heap setting.
- Run workflow/repository verification and typecheck.
- Push the exact head and require the assistant coverage CI shard to pass.
- Complete a valid exact-head ReviewGPT round after CI is green.

## Verification Results

- The exact serialized CI-mode assistant-engine coverage command passed: 142
  files passed, 1 skipped; 2,009 tests passed, 4 skipped.
- Repository verification-tool tests passed: 18 files and 300 tests.
- Full workspace typecheck passed.
- Doc gardening completed with zero issues.
- Independent focused review found no evidence-backed medium-or-higher issue;
  the heap override is limited to the one failing package command.

Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
