# Importer Normalization Dedupe

## Goal

Simplify duplicated raw-snapshot normalization helpers between the Oura and WHOOP device-provider importers without changing behavior, while keeping provider-specific field precedence explicit at the trust boundary.

## Constraints

- Zero observable behavior changes.
- Do not hide provider-specific precedence inside a generic schema abstraction.
- Preserve centralized raw-artifact omission and text trimming behavior in shared normalization helpers.
- Run importer package typecheck/tests plus the required completion audit flow.

## Scope

- `packages/importers/src/device-providers/oura.ts`
- `packages/importers/src/device-providers/whoop.ts`
- `packages/importers/src/device-providers/shared-normalization.ts`
- `packages/importers/test/device-providers.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Notes

- Expected extraction targets: plain-object/array coercion, id/slug/timestamp helpers, minute-difference helper, and a shared deletion/tombstone observation builder.
- Keep small provider-local wrappers if field precedence or naming aliases differ.
Status: completed
Updated: 2026-03-22
Completed: 2026-03-22
