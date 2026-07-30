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

## Retired progress-card URL API

Private-media hardening retains the experiment progress-card schema, types, and
bounded rendering constants for private in-vault PNG generation. It
intentionally removes only the URL encoder/decoder, encoded-length constant,
and public path builder previously exported from `@murphai/contracts`. Keeping
that codec would preserve a public health-data URL representation after its
product routes were retired, so the URL API must not return as a compatibility
shim.

Release `1.3.0` intentionally carries this breaking root-export removal while
the public package surface has no supported external compatibility commitment.
The package test keeps every retired runtime export absent.

Build layout:

- library entrypoints emit to `dist/*.js` and `dist/*.d.ts`
- package-local scripts emit to `dist/scripts/*.js`
