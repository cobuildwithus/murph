# PR 559 Invalid Companion Replay

## Goal

Close the exact-head ReviewGPT finding where a structurally invalid companion
RMSSD job terminalizes locally but its encrypted hosted payload remains pending,
causing immediate replay and replacement dead-row growth.

## Constraints

- Acknowledge only the exact structural-invalid terminal code.
- Keep every valid companion observation hosted until canonical import success.
- Keep ordinary canonical failures on the same future-scheduled local row.
- Do not weaken authentication, admission identity, encryption, or the no-raw-RR boundary.
- Reuse the existing terminal acknowledgment path; add no queue or lifecycle owner.

## Verification

- Prove the invalid companion job becomes dead once and promotes its exact hosted payload ID.
- Re-prove valid canonical failures retain one queued row and do not promote the payload.
- Run affected device-sync and assistant-runtime tests and typechecks.
- Close the plan, push with an exact remote-head guard, and rerun exact-head ReviewGPT with CI.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
