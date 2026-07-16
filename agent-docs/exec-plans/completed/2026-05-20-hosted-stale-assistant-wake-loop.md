# Stop stale hosted assistant wake recovery loop

Status: completed
Created: 2026-05-20
Updated: 2026-05-20

## Goal

- Stop the local hosted runtime loop where a stale assistant-labeled wake keeps producing scheduled Cloudflare/runtime logs with no mailbox or device-sync work.
- Explain the root cause from code and local DB evidence, then prove the fix with a hosted runtime entrypoint E2E regression.

## Success criteria

- A stale due assistant/null wake with device sync configured lets assistant/active-turn work run first, then runs the device-sync lane once only if the assistant pass proves idle instead of scheduling a synthetic 30s retry.
- When no dirty device-sync work remains, the hosted workspace run checkpoints `nextWakeAt: null`/`nextWakeReason: null` and returns idle.
- Real device-sync follow-up wakes are still preserved when the device-sync lane reports them.
- Focused assistant-runtime tests and typecheck pass.

## Scope

- In scope:
  - Hosted assistant phase wake selection for stale assistant/null wake reasons.
  - Unit coverage for legacy assistant/null alarm handling.
  - Hosted workspace entrypoint E2E coverage for the no-dirty stale wake path.
- Out of scope:
  - Device-sync terminal wake ordering work owned by the active sibling plan.
  - Local Linq process management or dev server restarts.

## Constraints

- Technical constraints:
  - Preserve explicit `device-sync.reconcile` alarm behavior.
  - Preserve fresh-input hot path behavior where device sync is deferred behind user-visible work.
  - Avoid broad scheduling rewrites or new runtime state.
- Product/process constraints:
  - Use local database evidence only; hosted production database inspection tooling is not for local work.
  - Do not expose identifiers, local paths, raw log payloads, or secrets.
  - Preserve unrelated dirty working-tree changes.

## Risks and mitigations

1. Risk: Treating every stale assistant wake as device-sync could slow fresh user-message handling.
   Mitigation: Only run the legacy recovery path for due alarm invocations without fresh conversation input.
2. Risk: Clearing stale wakes could drop a real device-sync follow-up.
   Mitigation: Keep the device-sync lane authoritative; if it reports a follow-up wake, checkpoint that explicit wake.

## Tasks

1. Confirm code and local DB evidence for the stale assistant wake loop.
2. Change the assistant phase so due legacy assistant/null alarms defer device-sync recovery until after an idle assistant pass instead of synthetic retrying.
3. Add/update focused phase tests for stale assistant/null alarm handling.
4. Add hosted workspace entrypoint E2E coverage for the stale no-dirty wake returning idle.
5. Run focused tests, typecheck, audits, and commit scoped changes if safe.

## Decisions

- The clean fix is to make the due legacy assistant/null alarm path execute the existing device-sync lane only after assistant work is proven idle. The old synthetic retry only changed the wake reason and could loop forever when no dirty work existed.
- Consumed no-work device-sync recovery wakes must still be treated as progress so the idle checkpoint durably clears the stale workspace wake from the control-plane DB.

## Verification

- Commands to run:
  - `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
  - `pnpm typecheck`
- Expected outcomes:
  - The new E2E returns idle after checkpointing a stale assistant-labeled device-sync wake to `nextWakeAt: null`/`nextWakeReason: null` with empty dirty state.
  - Existing explicit device-sync alarm coverage remains green.
- Results:
  - `pnpm --dir packages/assistant-runtime test hosted-runtime-workspace-assistant-phase.test.ts hosted-runtime-workspace-entrypoint.test.ts` passed: 2 files, 122 tests.
  - `pnpm typecheck` passed.
  - `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` passed: assistant-runtime typecheck/test and affected Cloudflare verify.
  - `git diff --check` passed.
Completed: 2026-05-20
