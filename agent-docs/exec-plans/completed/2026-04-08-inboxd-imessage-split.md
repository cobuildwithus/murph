# Split iMessage out of inboxd

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Remove iMessage-specific connector ownership from `@murphai/inboxd` so hosted/runtime consumers can depend on inbox core without inheriting the `@photon-ai/imessage-kit` closure.
- Keep local iMessage behavior working through an explicit optional owner package and an `inbox-services` environment seam.

## Success criteria

- `packages/inboxd/package.json` no longer depends on `@photon-ai/imessage-kit`.
- `packages/inboxd/src/index.ts` no longer exports iMessage-specific connector or normalize surfaces.
- A new owning package provides the iMessage connector/driver/normalize surface and is the only package that depends on `@photon-ai/imessage-kit`.
- `packages/inbox-services` consumes iMessage through an optional injected/loadable module seam rather than assuming iMessage lives inside `@murphai/inboxd`.
- Hosted/runtime paths that only need inbox core do not gain a transitive dependency on the new iMessage package.
- Focused tests/typechecks for the touched packages pass.

## Constraints

- Preserve unrelated dirty worktree edits, especially the active coverage lanes in `packages/assistant-engine`, `packages/inboxd`, and adjacent packages.
- Do not widen public package surfaces with file-shaped compatibility exports.
- Keep dependency direction one-way: the new iMessage package may depend on `@murphai/inboxd`, but inbox core must not depend back on the iMessage owner.
- Keep the local CLI/user-facing iMessage behavior intact.

## Current state

- Lane A landed as commit `086fa99d`: `@murphai/inboxd` no longer owns or exports the iMessage connector/normalize implementation, and the new `@murphai/inboxd-imessage` package owns the moved source plus iMessage-specific tests.
- Lane B is complete locally: `@murphai/inbox-services` now routes iMessage through an optional `InboxImessageRuntimeModule` seam and lazily loads `@murphai/inboxd-imessage` only when needed.
- Lane C landed as commit `b049aa80`: CLI/runtime tests now model iMessage as a separate injected runtime module and the CLI workspace aliases include `@murphai/inboxd-imessage`.
- Workspace integration is complete locally: `tsconfig.base.json` and `pnpm-lock.yaml` include the new package wiring needed for focused package builds/tests.

## Target shape

### 1. New iMessage owner package

- Introduce a new package, likely `@murphai/inboxd-imessage`.
- Move the current iMessage connector/normalize implementation there.
- Depend on:
  - `@murphai/inboxd`
  - `@photon-ai/imessage-kit`
- Export only the intentional iMessage surface:
  - connector creation
  - iMessage driver loader
  - iMessage normalize/types helpers if still needed by tests or local consumers

### 2. inboxd becomes core-only

- Remove iMessage exports from `packages/inboxd/src/index.ts`.
- Remove `@photon-ai/imessage-kit` from `packages/inboxd/package.json`.
- Keep shared chat connector abstractions in `@murphai/inboxd` because the iMessage owner will build on those.

### 3. inbox-services owns the optional seam

- Add an explicit iMessage module interface to `packages/inbox-services/src/inbox-app/types.ts`.
- Extend `InboxServicesDependencies`/environment so local callers can:
  - inject a ready iMessage module, or
  - let the environment lazily load `@murphai/inboxd-imessage`.
- Update connector instantiation and doctor/runtime flows to use that seam for iMessage only.
- Keep telegram/email/linq on `@murphai/inboxd`.

### 4. Consumer updates

- Update package dependencies so local CLI paths that need iMessage can reach the new package through `@murphai/inbox-services` dynamic/runtime loading rather than through hosted/core packages.
- Update focused tests/mocks that currently fake `createImessageConnector` on the inbox core module.

## Parallel lanes

### Lane A: New iMessage package + inboxd core cleanup

Own:
- `packages/inboxd/**`
- new `packages/inboxd-imessage/**`

Goal:
- move iMessage implementation out of inbox core and keep package boundaries clean

### Lane B: inbox-services seam refactor

Own:
- `packages/inbox-services/**`
- package manifests directly required by that seam

Goal:
- route iMessage through an optional module seam so hosted does not depend on the new package

### Lane C: Consumer/test/docs alignment

Own:
- `packages/cli/**` tests/mocks that reference the old seam
- docs/ledger/verification readback if needed

Goal:
- update consumers to the new seam and prove the split without widening package API

## Verification target

- `pnpm --filter @murphai/inboxd typecheck`
- `pnpm --filter @murphai/inboxd-imessage typecheck`
- `pnpm --filter @murphai/inbox-services typecheck`
- focused Vitest for touched inbox/iMessage/CLI boundary tests

## Verification run

- `pnpm install --no-frozen-lockfile`
- `pnpm deps:ignored-builds`
- `pnpm --filter @murphai/inboxd typecheck`
- `pnpm --filter @murphai/inboxd-imessage typecheck`
- `pnpm --filter @murphai/inbox-services typecheck`
- `pnpm --dir packages/cli typecheck`
- `pnpm --filter @murphai/inboxd-imessage test`
- `pnpm --filter @murphai/inbox-services test`
- `pnpm --dir packages/inboxd exec vitest run --config vitest.config.ts test/connectors-daemon.test.ts test/inboxd-connectors-coverage.test.ts test/inboxd-parsers-shared-coverage.test.ts test/inboxd.test.ts test/package-boundary.test.ts --no-coverage`
- `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/inbox-service-boundaries.test.ts test/inbox-cli.test.ts test/assistant-core-facades.test.ts --no-coverage`
Completed: 2026-04-08
