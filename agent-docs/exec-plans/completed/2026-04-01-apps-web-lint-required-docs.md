# Apps Web Lint Required Docs

## Goal

Update the durable verification docs so `apps/web` work explicitly requires lint as part of the package-level check set.

## Scope

- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/references/testing-ci-map.md`

## Constraints

- Docs/process-only change only.
- Keep the rule aligned with the current `apps/web verify` behavior instead of inventing a new script surface.
- Preserve unrelated active ledger edits.

## Verification

- Read back the touched doc sections for consistency.

## Notes

- The current durable docs already describe `apps/web verify` running lint, but the top-level required-check row for `apps/web` does not call lint out explicitly enough.
Status: completed
Updated: 2026-04-01
Completed: 2026-04-01
