## Goal

Land the downloaded Bryan Johnson Blueprint sauna research-landscape patch as a narrow incremental content update on top of the already-landed protocol-evidence schema and UI support.

## Scope

- `packages/health-commons/content/protocols/dry-sauna/bryan-johnson-blueprint.md`
- `packages/health-commons/content/sources/sauna/{bryan-johnson-sauna-protocol-2026-01-28,bryan-johnson-morning-routine-2026-04-08,bryan-johnson-saunamaxx-2026-04-14,linkedin-bryan-johnson-core-temp-2026-04-16,linkedin-bryan-johnson-core-temp-prototype-2026-04-03,linkedin-bryan-johnson-sauna-guide-2025-12-06,x-bryan-johnson-comprehensive-sauna-guide-2025-12-06,x-bryan-johnson-core-temp-2026-04-16,x-bryan-johnson-core-temp-update-2026-04-03,x-bryan-johnson-fired-review-2026-04-06,x-bryan-johnson-ice-balls-2026-04-09,x-bryan-johnson-most-people-sauna-wrong-2025-11-12}.md`
- `packages/health-commons/content/changes/2026-04.jsonl`
- directly coupled `packages/health-commons/generated/{catalog.hash,catalog.json,entities.ndjson,recent-changes.json}`

## Constraints

- Do not widen into schema, contracts, web projection, or UI work; those seams already exist in this checkout.
- Preserve unrelated dirty-tree edits, especially existing in-flight Health Commons source and generated-file work.
- Regenerate coupled Health Commons outputs from the current tree instead of replaying stale generated hunks verbatim.

## Verification

- `pnpm typecheck`
- `pnpm --dir packages/health-commons test:coverage`
- `pnpm test:smoke`
- regenerate/check Health Commons outputs through `pnpm --dir packages/health-commons verify` if the lane stays truthful after the focused commands
