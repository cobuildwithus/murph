# Error log redaction invariant

Status: completed
Created: 2026-06-17
Updated: 2026-06-17

## Goal

- Add a baseline invariant that error logs preserve enough redacted diagnostic context for later debugging.

## Success criteria

- `docs/contracts/00-invariants.md` says error logs must include both machine-readable failure codes/categories and redacted human-readable messages or cause context.
- The touched docs are read back.
- Required verification passes.

## Scope

- In scope: `docs/contracts/00-invariants.md`.
- Out of scope: runtime logging implementation changes.

## Constraints

- Technical constraints: keep the rule compatible with existing shared redaction guidance.
- Product/process constraints: do not weaken secret, credential, token, or direct identifier redaction requirements.

## Risks and mitigations

1. Risk: The invariant could encourage raw sensitive error logging.
   Mitigation: Make redaction mandatory and keep full raw error detail out of persisted/published logs.

## Tasks

1. Add the logging invariant. Done.
2. Read back the touched docs. Done.
3. Run required verification. Done.

## Decisions

- Place the rule under "Observability And Logging" beside the existing redaction bullets.

## Verification

- Ran `pnpm typecheck`: passed.
- Ran `pnpm test:smoke`: passed.
- Read back `docs/contracts/00-invariants.md`: passed; the invariant requires codes/categories plus redacted message/cause context.
Completed: 2026-06-17
