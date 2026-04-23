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

Build layout:

- library entrypoints emit to `dist/*.js` and `dist/*.d.ts`
- package-local scripts emit to `dist/scripts/*.js`
