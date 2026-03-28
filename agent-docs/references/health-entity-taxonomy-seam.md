# Health Entity Taxonomy Seam

Last verified: 2026-03-28

## Decision

`packages/contracts/src/health-entities.ts` should remain the shared owner of health taxonomy and registry projection metadata.

That file is the package-neutral source for:

- canonical health kinds and nouns
- id prefixes and lookup aliases used by generic lookup and inference
- scaffold payload templates reused by CLI and core flows
- registry directory, id/title/status keys, sort behavior, and transform helpers reused by query
- shared projection behavior such as protocol group derivation from relative paths

## Why This Seam Is Valuable

- It keeps contracts, query, and CLI aligned on one health taxonomy instead of letting each layer restate the same kinds.
- Query can stay focused on read-model projection because canonical registry metadata already lives upstream in contracts.
- CLI can reuse the same kinds, prefixes, aliases, and scaffold payloads instead of carrying a second taxonomy table.
- It centralizes the metadata most likely to drift. The file looks centralizing because it is performing real shared coordination work.

Deleting or redistributing this ownership would not remove duplication. It would spread taxonomy drift across contracts, query, and CLI.

## What Should Stay Package-Local

- query-specific record interfaces and read helpers
- CLI command wiring, method bindings, and operator-facing help text
- core mutation implementations

Those are adapter concerns. The taxonomy and registry projection metadata are not.

## Later Simplifications To Prefer

Reduce duplicate metadata around this seam, especially in CLI layers, rather than moving ownership out of contracts.

Highest-value follow-ups:

- collapse repeated CLI status-registry descriptor copy such as command descriptions, `show` help text, and payload filenames where they are derivable from shared definitions
- reduce repeated CLI method-name tables where kind-to-method naming is mechanical
- keep query registry definitions thin and shared-definition-backed; if more dedupe is needed, remove per-kind boilerplate there without relocating registry ownership

## Guardrail

Tests should keep asserting that query registry definitions and CLI generic lookup/template wiring inherit their taxonomy metadata from `health-entities.ts`.
