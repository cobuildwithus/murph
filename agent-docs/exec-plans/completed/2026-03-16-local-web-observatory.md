# Local web observatory

Status: completed
Created: 2026-03-16
Updated: 2026-03-16

## Goal

- Add a local-only Next.js web package that reads vault data through `@healthybob/query`, renders a small read-only observability surface, and participates truthfully in repo verification.

## Success criteria

- `packages/web` exists as a workspace package with a working local Next.js app and package scripts for `dev`, `build`, `start`, `typecheck`, and `test`.
- The app reads vault data only on the server through `@healthybob/query` and does not mutate canonical vault state.
- The first UI exposes a compact read-only overview from stable query primitives such as the current profile, sample summaries, timeline entries, and search results.
- When no vault path is configured, the app fails closed with a local setup screen rather than guessing or scanning arbitrary directories.
- Root verification/docs reflect the new web package and the required repo checks still pass or any unrelated blocker is documented precisely.
- The requested `npx skills add vercel-labs/next-skills` command has been run once from the repo root and once from `packages/web`.

## Scope

- In scope:
- `packages/web` scaffold, styling, server-side vault readers, and focused tests
- root/package verification wiring needed for the new package
- architecture/runtime/readme docs for the new local UI surface
- requested skill-install commands
- Out of scope:
- write flows back into the vault
- networked auth, telemetry, or remote deployment
- medical recommendations or undefined product semantics

## Constraints

- Keep the app local-only and read-only.
- Do not read `.env` files; use runtime environment variables only if provided by the process.
- Preserve adjacent edits from the active green-checks lane.
- Keep the first UX small and operator-facing because product semantics are still undefined.

## Risks and mitigations

1. Risk: Next.js workspace wiring can drift from the repo’s current TypeScript verification model.
   Mitigation: add explicit package scripts and update repo-level verification/docs in the same change.
2. Risk: a web UI could accidentally bypass the read-only query boundary.
   Mitigation: keep all data access in server-only helpers that import `@healthybob/query` directly.
3. Risk: local vault-path configuration could become confusing or unsafe.
   Mitigation: require an explicit env var and show a setup screen with a deterministic fixture fallback example.

## Tasks

1. Register the lane, inspect workspace verification, and scaffold `packages/web`.
2. Implement server-only vault loading helpers plus a focused read-only homepage and API surface.
3. Add narrow tests and wire the package into repo verification/docs.
4. Run the requested skill-install commands, then execute completion-workflow audits and required repo checks.
5. Remove the ledger row, close the plan, commit scoped files, and hand off results.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Focused checks: `pnpm --dir packages/web typecheck`, `pnpm --dir packages/web test`.
Completed: 2026-03-16
