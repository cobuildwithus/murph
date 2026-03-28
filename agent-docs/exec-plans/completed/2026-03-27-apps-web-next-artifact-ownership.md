# Hosted web Next artifact ownership

Status: completed
Created: 2026-03-27
Updated: 2026-03-28
Completed: 2026-03-28

## Goal

- Stop `apps/web` interactive dev from sharing mutable Next build state with repo build/test/clean commands, while keeping the shared workspace source-resolution helper as the single source of truth for the hosted/local web package maps.

## Success criteria

- `apps/web dev` runs through a repo-owned wrapper that keeps interactive dev artifacts out of the shared `apps/web/.next` build directory.
- `apps/web build` no longer starts by deleting `.next`, and repo verification still exercises the hosted app build successfully.
- Repo verification for `apps/web` includes a real cold-boot `next dev` smoke that makes repeated requests instead of only config assertions.
- The shared `config/workspace-source-resolution.ts` helper owns the hosted/local web package maps used by Next/Vitest.
- Repo artifact-hygiene guards and docs recognize the hosted dev artifact directory so it does not become a new leak path.

## Scope

- In scope:
  - hosted web Next wrapper/config/package-script updates
  - shared source-resolution helper ownership for hosted/local web package maps
  - hosted dev smoke harness and focused tests
  - artifact-hygiene/doc updates required by the new dev artifact directory
- Out of scope:
  - broader repo-wide `.ts` import conversion
  - upstream Turbopack persistence bug fixes
  - product/UI changes in `apps/web`

## Constraints

- Keep `apps/web` runtime behavior unchanged outside dev/build/test artifact ownership and verification.
- Do not reintroduce custom Turbopack source-rewrite loaders.
- Preserve existing hosted env loading behavior; unlike `packages/web`, the hosted app still needs local `.env` reads in development.

## Tasks

1. Centralize the hosted/local web workspace-source package maps in `config/workspace-source-resolution.ts`.
2. Add a hosted-web Next wrapper and separate interactive dev artifacts from the shared build directory.
3. Add a cold-boot hosted `next dev` smoke proof and thread it into the hosted app test path.
4. Update artifact hygiene guards and hosted verification docs for the new dev artifact directory.

## Outcome

- Centralized the shared workspace-source resolution helper for the hosted and local web apps.
- Split hosted interactive dev artifacts away from shared build output and aligned verification/hygiene around the dedicated hosted dev directories.
- Added focused hosted/local web config coverage so the new Next artifact ownership stays explicit.
