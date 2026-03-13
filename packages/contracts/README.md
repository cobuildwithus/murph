# `@healthybob/contracts`

Owns the frozen vault contracts for the Healthy Bob baseline:

- canonical Zod schemas and parse helpers
- TypeScript declarations
- example records and frontmatter documents
- derived JSON Schema artifacts under `generated/`

Package-local commands:

- `pnpm --dir packages/contracts build`
- `pnpm --dir packages/contracts generate`
- `pnpm --dir packages/contracts verify`

Build layout:

- library entrypoints emit to `dist/*.js` and `dist/*.d.ts`
- package-local scripts emit to `dist/scripts/*.js`
