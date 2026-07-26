# `@murphai/contracts`

Owns the frozen vault contracts for the Murph baseline:

- canonical Zod schemas and parse helpers
- TypeScript declarations
- example records and frontmatter documents
- derived JSON Schema artifacts under `generated/`

Surface split:

- `@murphai/contracts` is the primary JS API and exports the canonical Zod-first runtime surface.
- `@murphai/contracts/schemas` remains the dedicated artifact-consumer subpath for derived JSON Schema objects.
- `@murphai/contracts/generated/*` exposes the emitted schema artifact files.

Package-local commands:

- `pnpm --dir packages/contracts build`
- `pnpm --dir packages/contracts generate`
- `pnpm --dir packages/contracts verify`

## Next major public API boundary

Private-media hardening intentionally removes the experiment progress-card
schema, types, constants, URL encoder/decoder, and path builder that were
exported from `@murphai/contracts` 1.2.4. Keeping that codec would preserve a
public health-data URL representation after its product routes were retired,
so the removed API must not return as a compatibility shim.

This breaking root-export removal may publish only with the next shared major
release. `scripts/release-manifest.json` blocks an expected release version
below 2.0.0; use `pnpm release:major`, not `pnpm release:patch` or
`pnpm release:minor`. The package test asserts that the retired runtime exports
remain absent, and the release-policy test records the complete removed export
set at that major boundary.

Build layout:

- library entrypoints emit to `dist/*.js` and `dist/*.d.ts`
- package-local scripts emit to `dist/scripts/*.js`
