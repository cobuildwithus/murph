# Parser layer on top of inboxd

Status: completed
Created: 2026-03-13
Updated: 2026-03-13

## Goal

- Land a clean `@healthybob/parsers` layer on top of `@healthybob/inboxd` that discovers local parsing implementations, chooses from a deterministic priority stack, and persists rebuildable parse outputs for downstream layers.
- Extend `@healthybob/inboxd` so attachments have stable ids and attachment-level parse jobs/results instead of the current capture-level placeholder queue.

## Success criteria

- Inbox attachments get stable `attachmentId` values persisted into raw envelopes, runtime attachment rows, and hydrated capture records.
- Runtime indexing tracks attachment parse jobs plus parse state/result metadata without making parser output canonical.
- New `packages/parsers` exposes contracts, a provider registry, local-first adapters, a worker pipeline, and derived artifact publication under `derived/inbox/**`.
- Workspace build/typecheck/test wiring includes the new package truthfully.
- Focused tests cover stable attachment ids, queue/runtime behavior, provider fallback, derived artifact publishing, and search refresh after parse.

## Scope

- In scope:
  - `packages/inboxd/src/**`
  - `packages/inboxd/test/**`
  - `packages/parsers/**`
  - workspace/package wiring for the new parser package
  - ownership-safe docs for the inbox/parser architecture seam
- Out of scope:
  - CLI command registration
  - remote parsing providers
  - promotion of parser outputs into canonical health records
  - files currently owned by other active coordination-ledger entries

## Constraints

- Keep the parser layer local-first, open-source-first, and optional-dependency-friendly.
- Preserve rebuildability from vault evidence and keep parser artifacts derived-only.
- Avoid `ARCHITECTURE.md` and `packages/inboxd/README.md` until their owning lane releases them.

## Risks and mitigations

1. Runtime schema changes could drop parse state on rebuild.
   Mitigation: use stable attachment ids, attachment-level upserts, and explicit rebuild re-enqueue logic.
2. Workspace wiring could become incomplete if the new package is not added to root scripts/TS paths.
   Mitigation: update root package scripts, TypeScript path mappings/references, and verification docs in the same change.
3. Provider adapters could become environment-fragile.
   Mitigation: keep discovery explicit and deterministic, and structure adapters behind a narrow provider contract.

## Tasks

1. Audit the supplied parser-layer patch against the live workspace and capture missing integration work.
2. Extend `packages/inboxd` contracts/runtime/persistence/tests for stable attachment ids and attachment parse jobs/results.
3. Add `packages/parsers` with contracts, provider registry, adapters, writer, bridge, worker, and focused tests.
4. Update docs plus workspace verification wiring for the new package and architecture boundary.
5. Run required checks, completion audits, and remove the coordination-ledger entry before handoff.

## Verification

- `pnpm --dir packages/inboxd test`
- `pnpm --dir packages/parsers test`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Completed: 2026-03-13
