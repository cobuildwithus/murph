# Health Entity Taxonomy Seam

Last verified: 2026-04-06

## Decision

`packages/contracts/src/health-entities.ts` should remain the shared owner of health taxonomy and registry metadata for Murph's health registry families.

That file is now the package-neutral source for:

- canonical health kinds and nouns
- id prefixes and lookup aliases used by generic lookup and inference
- scaffold payload templates reused by CLI and core flows
- per-family registry directory, id/title/status keys, relation metadata, and validation schemas
- shared query projection metadata for health registry families, including sort behavior and attribute transform helpers
- shared mechanical CLI metadata for health registry families, including list/show/scaffold/upsert method names, payload filenames, status-filter labels, and runtime-method overrides
- shared projection behavior such as protocol group derivation from relative paths

## Why This Seam Is Valuable

- It keeps contracts, query, and CLI aligned on one health taxonomy instead of letting each layer restate the same kinds.
- Query can stay focused on read-model projection because health-family sort/transform metadata already lives upstream in contracts.
- CLI can reuse the same kinds, prefixes, aliases, scaffold payloads, and mechanical command metadata instead of carrying a second command-derivation table.
- It centralizes the metadata most likely to drift. The file looks centralizing because it is performing real shared coordination work.

Deleting or redistributing this ownership would not remove duplication. It would spread taxonomy drift across contracts, query, and CLI.

## What Should Stay Package-Local

- query-specific record interfaces and read helpers
- non-health bank families that have not yet been ported onto the shared health-definition shape
- CLI operator-facing help text beyond the shared mechanical metadata
- core mutation implementations and markdown rendering adapters

Those are adapter concerns. The taxonomy and health-family registry projection/command metadata are not.

## Later Simplifications To Prefer

Reduce duplicate metadata around this seam, especially in non-health bank registry families, rather than moving ownership out of contracts.

Highest-value follow-ups:

- port additional bank registry families onto the richer shared definition shape now used by the health registry families
- collapse repeated CLI help/descriptive copy where it is derivable from shared definitions
- keep query registry definitions thin and shared-definition-backed; if more dedupe is needed, remove per-kind boilerplate there without relocating registry ownership

## Guardrail

Tests should keep asserting that health-family query registry definitions and CLI generic lookup/template wiring inherit their projection and command metadata from `health-entities.ts`.
