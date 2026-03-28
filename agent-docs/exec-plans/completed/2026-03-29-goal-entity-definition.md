# Goal Entity Definition

## Goal

Port Goal onto one shared registry entity definition so contracts, core, query, and CLI stop re-describing the same Goal metadata and document semantics.

Success criteria:

- one Goal-focused definition owns the registry schema, payload schema, storage directory, id and slug behavior, markdown/frontmatter transforms, relation extraction, sort behavior, and query projection metadata
- core Goal read/write logic consumes that definition instead of carrying Goal-specific parser or serializer drift
- query Goal projection logic and CLI Goal descriptor wiring consume the same shared definition where the metadata is mechanical
- Goal behavior, markdown shape, and storage layout remain compatible with the current vault model

## Scope

- `packages/contracts/src/{health-entities.ts,shares.ts,zod.ts,examples.ts,schemas.ts}` as needed for the shared Goal definition and payload/schema alignment
- `packages/core/src/{bank/{goals,types}.ts,registry/{api,markdown}.ts,index.ts,public-mutations.ts}`
- targeted `packages/core/test/*`
- `packages/query/src/{canonical-entities.ts,health/{canonical-collector,goals,registries}.ts,index.ts}`
- targeted `packages/query/test/*`
- `packages/cli/src/{health-cli-descriptors.ts,health-cli-method-types.ts,usecases/explicit-health-family-services.ts,assistant-cli-tools.ts}`
- targeted `packages/cli/test/*`
- docs only if the landed seam changes the documented ownership story

## Constraints

- Keep the existing markdown plus JSONL storage model; do not invent a new persistence layer.
- Keep Goal frontmatter and human-facing markdown structure compatible unless a tested migration is strictly required.
- Limit shared abstractions to Goal plus immediately reusable registry helpers that earn their keep now.
- Preserve overlapping worktree edits and active ledger rows.
- Run required verification and mandatory completion-workflow audit passes before handoff.

## Risks

- Introducing a shared abstraction that is too generic or speculative for the current codebase.
- Breaking Goal read or upsert compatibility by moving parser and serializer ownership.
- Letting query or CLI keep hidden Goal-specific assumptions that the new definition fails to represent.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- focused Goal-related package tests during iteration
- direct scenario check: scaffold, upsert, list, and show Goal through the built surface or focused tests proving the descriptor-driven path
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
