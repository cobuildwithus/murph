# Remove Codex History-Unsafe Reset

## Goal

Delete the mechanism that abandons Codex thread continuity when runtime output differs from delivered output or a private tool returns data. Preserve the existing delivery decisions and normal continuity rules without adding reconciliation state or replacement machinery.

## Scope

- Remove the `codexThreadHistoryUnsafe` result and callback plumbing.
- Stop clearing resume state for `finish_without_reply`, suppressed segments, and membership reads.
- Keep ordinary resume clearing when no resumable provider thread exists or session routing changes.
- Update focused tests and durable architecture/security guidance.

## Verification

- Run focused assistant-engine tests covering dynamic tools, Codex turns, local service finalization, and provider recovery.
- Run the truthful diff verification lane.
- Complete the required security/privacy and coverage-write audits, then the pushed-head ReviewGPT loop with CI.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
