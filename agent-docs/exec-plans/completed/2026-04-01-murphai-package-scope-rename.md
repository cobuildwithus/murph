## Goal

Switch the publishable Murph package family from `murph` / `@murph/*` to `@murphai/murph` / `@murphai/*` while keeping the product and executable name `murph`.

## Why

- The unscoped `murph` npm package name is already taken.
- The `@murphai` npm org is now available and should own the public package namespace.
- The release, install, and import surface need to agree before the first public publish.

## Scope

- Rename the publishable package manifests and workspace dependency names to `@murphai/*`.
- Update source imports, installer/release metadata, and durable docs that describe the publish surface.
- Keep the CLI bins named `murph` and `vault-cli`.
- Preserve unrelated in-flight edits elsewhere in the repo.

## Constraints

- Do not introduce new dependencies.
- Keep the root private workspace package private.
- Verify the renamed workspace still builds/tests before release handoff.
- Keep the user-facing product name as Murph unless a doc specifically needs the npm scope.

## Plan

1. Inventory every manifest/import/doc reference that still assumes `murph` or `@murph/*` as the package namespace.
2. Apply the `@murphai` rename across manifests, imports, release metadata, installer paths, and durable docs.
3. Run required verification and capture any direct release-surface proof that is practical locally.
4. Run the required final review pass, address findings, and commit only the touched paths.
Status: completed
Updated: 2026-04-01
Completed: 2026-04-01
