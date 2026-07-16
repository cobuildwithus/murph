# Hosted Redacted JSON Ownership Consolidation

Status: completed
Updated: 2026-07-15

## Why

`@murphai/hosted-execution` and the web hosted-workspace persistence layer
independently maintain the same structural redacted-JSON parser and key/value
allowlist. The copies can drift at a privacy boundary: the package parser
already rejects URLs and direct identifiers while the web copy does not.

The shared hosted-execution package should own this wire-format validation.
Web should adapt only its persistence-specific convention that an empty object
is stored as `null`.

## Scope

- Export the existing structural parser through the hosted-execution parser
  surface without moving diagnostic free-text construction or normalization.
- Make hosted-workspace persistence consume that shared parser.
- Delete the duplicated web constants and helper functions.
- Preserve the canonical-write-receipt reserved-key field-budget semantics.
- Preserve web's empty-object-to-`null` persistence behavior.
- Add focused regression proof for URL and direct-identifier rejection at the
  web persistence boundary.

## Steps

1. Expose the package-owned parser with its existing optional reserved-key set.
2. Replace the web parser copy with a thin persistence adapter.
3. Add direct package-export and web-boundary regressions.
4. Run focused package/web tests, typechecks, `pnpm test:diff`, diff checks, and
   a privacy scan.

## Constraints

- Do not alter hosted group-membership parsing or the unrelated open-PR area in
  `runtime-control.ts`.
- Do not broaden accepted diagnostic keys or weaken scalar/string validation.
- Do not introduce another abstraction or dependency.

## Verification

- `pnpm --dir packages/hosted-execution test -- hosted-runtime-control.test.ts`
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir apps/web test -- hosted-workspace-store.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm test:diff`
- `git diff --check`

Completed: 2026-07-15
