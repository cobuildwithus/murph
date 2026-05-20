# Hosted Device Terminal Queue Gating

Status: completed
Created: 2026-05-20
Updated: 2026-05-20

## Goal

Close the remaining hosted device-sync terminal-account queue window found by
ReviewGPT after `dbf18af33cc0`: once hosted state hydrates a connection as
`disconnected` or `reauthorization_required`, the same runtime sync pass must
not recreate local queued work from stale wake hints or dirty rows.

## Success Criteria

- Terminal hosted account status is detected through one local helper in
  `hosted-device-sync-runtime.ts`.
- Hydration cleanup, wake-hint processing, and dirty-state processing all use
  the same terminal-status decision.
- Terminal wake hints and disconnected dirty rows have focused regression tests.
- Verification and required completion audits pass, or blockers are recorded.

## Scope

- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`

## Constraints

- Keep the fix small and provider-generic.
- Preserve the hosted control plane as the source of truth for terminal status.
- Do not add new persisted state or new retry infrastructure.
- Logs stay metadata-only and must not include tokens, payload bodies, raw user
  identifiers, or local paths.

## Plan

1. Add a terminal-status helper and shared pending-job dead-letter helper.
2. Reuse those helpers during hydration, wake-hint processing, and dirty-state
   processing.
3. Add focused tests for terminal wake hints and disconnected dirty-state rows.
4. Run focused assistant-runtime tests, typecheck, diff check, and required
   completion audits.
5. Close the plan, commit scoped files, and push to `main`.

## Verification

- Passed:
  - `pnpm --filter @murphai/assistant-runtime test -- test/hosted-device-sync-runtime.test.ts`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-device-sync-runtime.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts agent-docs/exec-plans/active/2026-05-20-hosted-device-terminal-queue-gating.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - `git diff --check -- packages/assistant-runtime/src/hosted-device-sync-runtime.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts agent-docs/exec-plans/active/2026-05-20-hosted-device-terminal-queue-gating.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Required audits:
  - `security-privacy-review`: no actionable findings.
  - `coverage-write`: added both-status terminal wake-hint coverage; no further gap.
  - `task-finish-review`: found terminal dirty-state ordering and idempotent hydration cleanup gaps; both fixed and reverified.
  - focused security follow-up after moving terminal ack before provider registration: no actionable findings.
Completed: 2026-05-20
