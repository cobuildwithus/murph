# Hosted device-sync wake hardening

Status: completed
Created: 2026-05-18
Updated: 2026-05-18

## Goal

Harden the hosted device-sync wake fix after five-agent review so equal
timestamps, invalid timestamp comparisons, and legacy assistant-labeled
device-sync alarms do not recreate the WHOOP quiet-lately/stuck-sync failure.

## Success Criteria

- Device-sync wake ownership wins deterministic ties against assistant/null
  ownership when timestamps are equal.
- Invalid wake timestamps do not prevent later valid candidates from winning.
- A due legacy alarm that looks like a pre-fix assistant-labeled device-sync
  wake gets a bounded recovery path instead of being cleared forever.
- Focused regressions cover equal-timestamp and legacy recovery behavior.
- Scoped assistant-runtime verification passes.

## Scope

- In scope:
  - Hosted runtime invocation-level wake projection merging.
  - Hosted assistant-runtime wake candidate ordering and skip/recovery logic.
  - System mailbox post-checkpoint wake reason propagation for device-sync
    follow-up wakes.
  - Focused assistant-runtime tests for reviewed edge cases.
- Out of scope:
  - Multi-intent scheduler redesign.
  - Cloudflare Durable Object alarm implementation changes.
  - Local database mutation or repair.

## Constraints

- Keep architecture simple: do not introduce a new persisted scheduler model.
- Preserve hot-path behavior: active/fresh input should not run background
  device-sync work.
- Do not log or expose health/provider payloads, account ids, tokens, local
  paths, or direct user identifiers.
- Preserve unrelated dirty working-tree edits.

## Tasks

1. Register follow-up scope.
2. Patch deterministic wake candidate comparison and bounded legacy recovery.
3. Add focused regressions for equal timestamp ownership and legacy recovery.
4. Run scoped assistant-runtime tests/typecheck and diff-aware verification.
5. Commit/close the follow-up if the checkout allows a safe scoped commit.

## Verification

Passed:

- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-wake-candidates.test.ts hosted-runtime-maintenance.test.ts hosted-runtime-workspace-assistant-phase.test.ts hosted-runtime-workspace-entrypoint.test.ts`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/wake-candidates.ts packages/assistant-runtime/src/hosted-runtime/maintenance.ts packages/assistant-runtime/src/hosted-runtime/system-mailbox.ts packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-wake-candidates.test.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `git diff --check -- <task files>` plus `git diff --no-index --check /dev/null` for the two new wake-candidate files.
- Five local review agents completed; findings on raw dirty-wake ordering, broad
  legacy recovery, outer projection tie ordering, and fresh-input wake dropping
  were addressed before final verification.
Completed: 2026-05-18
