# Hard-cut hosted device-sync SQL to opaque refs and typed summaries

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Remove the remaining hosted device-sync SQL surfaces that can carry raw provider account ids, human-readable provider labels, or open-ended provider payloads.

## Success criteria

- `apps/web/prisma/schema.prisma` no longer stores raw provider `externalAccountId`, provider `displayName`, or open-ended `metadataJson` / `payloadJson` fields for hosted device-sync tables.
- Hosted device-sync lookup and dedupe paths use opaque ids plus blind indexes instead of raw provider account ids in Postgres.
- Ordinary hosted-web/settings reads still work from SQL-backed typed summaries without requiring raw provider payload storage in Postgres.
- Raw provider identifiers and provider-facing labels remain only in the encrypted hosted runtime/device-sync path, not in Postgres-backed public/control-plane tables.
- Shared TypeScript surfaces stop treating raw provider account ids as part of the public hosted connection shape by default.

## Scope

- In scope:
- `apps/web/prisma/**`
- `apps/web/src/lib/device-sync/**`
- `apps/web/test/**`
- `packages/device-syncd/**`
- `packages/assistant-runtime/**`
- `packages/hosted-execution/**`
- `ARCHITECTURE.md`
- `apps/web/README.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- This active plan
- Out of scope:
- New provider support or new sync product behavior
- Reworking Cloudflare encrypted runtime storage beyond what the SQL hard cut requires
- Local `packages/device-syncd` SQLite privacy cleanup unless needed to keep shared contracts coherent

## Constraints

- Technical constraints:
- Keep hosted SQL limited to opaque refs, blind indexes, status/summary fields, and timestamps.
- Preserve fail-closed ownership, dedupe, and runtime-mismatch checks while removing raw SQL fields.
- Keep raw provider ids and labels available only where the encrypted hosted runtime/local runtime actually needs them.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Follow the repo high-risk verification and completion-review workflow, including direct scenario proof.

## Risks and mitigations

1. Risk: Removing raw account ids from SQL can break webhook ownership mapping or duplicate-connection detection.
   Mitigation: Introduce a stable keyed blind index and switch all lookup paths atomically.
2. Risk: Removing generic signal JSON can starve the hosted settings surface of stale summaries.
   Mitigation: Replace generic JSON with typed signal/audit summary columns that encode only the specific fields the settings/runtime surfaces consume.
3. Risk: Existing shared types still assume raw provider ids are generally available.
   Mitigation: Narrow shared/public types in the same change so the compiler exposes any remaining leaks.

## Tasks

1. Register the exclusive hosted device-sync storage lane and capture the target hard-cut plan.
2. Replace the hosted Prisma device-sync schema with opaque ids, blind indexes, and typed summary/audit/session fields; add the matching migration.
3. Refactor hosted device-sync stores, runtime helpers, and shared types to remove SQL dependencies on raw provider ids, display labels, and generic JSON blobs.
4. Update hosted tests and durable architecture/docs to reflect the new privacy boundary.
5. Run required verification, collect direct scenario evidence, complete the required review audit, and finish with a scoped commit.

## Decisions

- Treat provider account lookup as a blind-index concern, not a raw Postgres data concern.
- Keep provider-facing labels out of Postgres entirely instead of preserving a “safe” display-name cache.
- Replace generic JSON columns with typed fields only where a real consumer exists; otherwise delete the column rather than narrowing it cosmetically.

## Verification

- Commands to run:
- `pnpm --dir apps/web prisma:generate`
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Expected outcomes:
- Hosted device-sync schema/client/tests compile and pass with SQL storing only the narrowed typed control-plane surface, and the documented privacy boundary matches the implementation.
Completed: 2026-04-07
