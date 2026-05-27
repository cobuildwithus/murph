# Remove Local Gateway Runtime

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

Remove the local gateway runtime and rebuildable gateway SQLite projection while keeping normal local assistant daemon control and hosted/local execution working.

## Success criteria

- `packages/gateway-local` is deleted.
- No production package depends on `@murphai/gateway-local`.
- `assistantd` keeps normal chat, session, status, outbox, cron, and automation routes, but no longer exposes `/gateway/*`.
- Hosted-local and Cloudflare runner package closure no longer include `@murphai/gateway-local`.
- Runtime-state no longer advertises `.runtime/projections/gateway.sqlite` as a live local projection path.
- Live architecture and verification docs describe the new shape.

## Scope

- In scope:
  - Delete `packages/gateway-local`.
  - Remove local gateway assistantd routes, client helpers, service composition, tests, and docs.
  - Remove assistant-engine gateway-local adapter exports.
  - Remove gateway-local package references from manifests, tsconfig, Vitest config, scripts, CI, release/package-shape tests, runner bundle tests, and lockfile.
  - Remove or update runtime-state gateway projection path descriptors and tests.
  - Keep `@murphai/gateway-core` for hosted Cloudflare gateway projection/cache helpers.
- Out of scope:
  - Removing `@murphai/gateway-core`.
  - Changing hosted Cloudflare gateway projection behavior.
  - Replacing local gateway with a new transport adapter.

## Constraints

- Preserve unrelated active work in other checkouts.
- Do not edit immutable completed execution-plan snapshots.
- Do not expose local paths, user identifiers, secrets, raw auth headers, mailbox payloads, transcripts, or provider payloads in logs/docs/tests.
- Prefer deletion over migration; local MCP/headless gateway support is intentionally removed.

## Tasks

1. Remove local gateway runtime and daemon/API wiring.
2. Remove package graph, build, CI, and runner bundle references.
3. Remove runtime-state gateway projection descriptors and update tests.
4. Update current architecture/package docs and verification maps.
5. Run focused verification, required audits, final integration checks, and publish a PR.

## Verification

- Fast-forwarded the branch to latest `main` (`4b3ec025b`) and replayed this task diff on top.
- Earlier remote-main sync conflict in `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` was resolved by preserving active rows and adding only this task row.
- Fixed one current-main merge fallout in `packages/cli/src/commands/event.ts`: manual typed observation events now mark `queryVisibility: "default"` so the new dense-observation query filter still allows human-entered observations to be shown.
- Passing:
  - `pnpm --dir packages/query build` followed by `pnpm --dir packages/vault-usecases typecheck` to refresh latest-main package-export declarations before the final root typecheck.
  - `pnpm typecheck`
  - `pnpm --dir packages/assistantd test:coverage`
  - `pnpm --dir packages/gateway-core test:coverage`
  - `pnpm --dir packages/runtime-state test:coverage`
  - `pnpm --dir packages/assistant-engine test:coverage`
  - `pnpm --dir packages/assistant-runtime test:coverage`
  - `pnpm --dir packages/cli verify:coverage`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-bundle-contract.test.ts test/runner-bundle-workspace-artifacts.test.ts test/container-image-contract.test.ts --coverage --maxWorkers 1`
  - `git diff --check`
- Failing, pre-existing on local `main`:
  - `pnpm deps:audit` reports `@privy-io/react-auth > js-cookie@3.0.5` affected by GHSA-qjx8-664m-686j; `main:pnpm-lock.yaml` already contains the same dependency path.
Completed: 2026-05-27
