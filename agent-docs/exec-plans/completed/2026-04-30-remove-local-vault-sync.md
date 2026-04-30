# Remove local vault sync hard cut

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

- Remove the local vault sync / local-to-hosted import feature entirely.
- Success means the settings UI no longer offers "Sync local vault", local agents cannot exchange/upload vault-sync sessions, hosted runtime cannot fetch/apply `vault.sync.import` side inputs, and package APIs no longer expose vault-sync import-pack or merge abstractions.

## Success criteria

- User-facing copy "Sync local vault", "Local-to-hosted import", and "Adds missing local records while preserving hosted data." is gone.
- Hosted web API routes, Prisma models, services, privacy/export/retention handling, and tests for hosted vault-sync sessions/payloads are removed or revised.
- Runtime and transport code no longer recognizes `vault.sync.import`, vault-sync payload routes, or `vault-sync-import` hosted bundle kinds.
- Core and CLI vault-sync abstractions, exports, command surface, and tests are removed.
- Durable docs describe the hard-cut current state without leaving active vault-sync product/API claims.

## Scope

- In scope: `apps/web`, `apps/cloudflare`, `packages/{assistant-runtime,hosted-execution,runtime-state,core,cli}`, directly coupled tests, migrations/baseline schema, generated public schema artifacts if required, and current durable docs.
- Out of scope: unrelated dirty UI/dashboard work, device-sync behavior, browser-vault dashboard sidecar behavior, active hosted runtime work not directly tied to vault-sync imports, and completed historical execution-plan archives except where active docs index/current docs require updates.

## Constraints

- Technical constraints: preserve package boundary rules; do not leave compatibility shims for this greenfield hard cut; do not add new dependencies; keep hosted execution mailbox/device/conversation behavior intact.
- Product/process constraints: protect unrelated dirty-tree edits; avoid exposing local personal identifiers in generated files, docs, commits, or handoff; required security/privacy, coverage, frontend, and final review passes apply because this touches sensitive data state, APIs, runtime behavior, and settings UI.

## Risks and mitigations

1. Risk: stale route/kind parser support keeps an unreachable feature alive.
   Mitigation: search for all vault-sync strings after deletion and fail closed on any remaining active-code references.
2. Risk: removing Prisma models without updating account deletion/export/retention tests breaks privacy workflows.
   Mitigation: revise privacy services to stop reporting vault-sync stores and run focused hosted-web tests.
3. Risk: runtime mailbox routing changes accidentally affect conversation/device-sync system messages.
   Mitigation: keep edits narrowly on `vault.sync.import` branches and run focused assistant-runtime/hosted-execution/Cloudflare tests.

## Tasks

1. Inventory all active vault-sync feature files and overlap with dirty work.
2. Remove hosted web vault-sync UI, API routes, services, Prisma models, and tests.
3. Remove hosted runtime/transport support for vault-sync mailbox side inputs and import callbacks.
4. Remove core import-pack/merge primitives, runtime bundle kind support, CLI `sync push`, exports, and focused tests.
5. Update durable current docs and run residue searches.
6. Run focused verification, required audit passes, and close/commit if safe.

## Decisions

- Hard cut means deleting the feature surface rather than leaving hidden routes, parsers, or local compatibility helpers.

## Verification

- Commands to run: residue searches; focused Vitest/package tests for touched owners; `pnpm typecheck`; `git diff --check`.
- Expected outcomes: no active-code/local UI references to local vault sync remain; focused tests and typecheck pass or any unrelated blockers are named precisely.
- Completed: residue searches across source, rebuilt package outputs, docs outside completed exec-plan archives, and fresh Next output return no vault-sync/local-to-hosted import hits.
- Completed: `pnpm typecheck`, `pnpm --dir apps/web typecheck`, `pnpm --dir apps/web build`, focused hosted-web tests, `pnpm --dir packages/hosted-execution test`, `pnpm --dir packages/assistant-runtime test`, and `pnpm --dir apps/cloudflare test`.
- Completed after audit follow-up: drop-only forward migration cleanup for existing hosted vault import tables, stale Data & privacy modal copy removal, operator-config CLI default-vault cleanup, Cloudflare web-control negative coverage, settings/core negative coverage, and live-doc cleanup.
- Known unrelated blocker: full `pnpm --dir apps/web test` is red on pre-existing dashboard/sidebar and footer copy expectations outside this vault-sync removal.
- Known unrelated blocker: a later `pnpm --dir apps/web build` no longer hits the removed `./vault-sync.ts` import, but fails on client bundling of server-only Node modules from unrelated active query/importer paths.
- Known unrelated blocker: focused assistant-runtime system-mailbox test loading is blocked by unrelated active assistant input-store work (`safeAssistantInputTokenSchema` undefined).
- Not completed: root `pnpm test` was interrupted by the user before completion.
Completed: 2026-04-30
