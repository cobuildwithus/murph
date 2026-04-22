## Goal

Land the supplied Bryan Johnson Blueprint sauna research patch as a narrow Health Commons content/source-corpus update on top of the already-landed protocol-evidence schema and UI support.

## Scope

- `packages/health-commons/content/protocols/dry-sauna/bryan-johnson-blueprint.md`
- `packages/health-commons/content/sources/sauna/{bryan-johnson-sauna-protocol-2026-01-28,bryan-johnson-morning-routine-2026-04-08,bryan-johnson-saunamaxx-2026-04-14,linkedin-bryan-johnson-core-temp-2026-04-16,linkedin-bryan-johnson-core-temp-prototype-2026-04-03,linkedin-bryan-johnson-sauna-guide-2025-12-06,x-bryan-johnson-comprehensive-sauna-guide-2025-12-06,x-bryan-johnson-core-temp-2026-04-16,x-bryan-johnson-core-temp-update-2026-04-03,x-bryan-johnson-fired-review-2026-04-06,x-bryan-johnson-ice-balls-2026-04-09,x-bryan-johnson-most-people-sauna-wrong-2025-11-12,doi-10.1155-2014-106049,mayo-2018-sauna-review,pmid-11165553,pmid-16871826,pmid-16877041,pmid-23411620,pmid-25705824,pmid-28633297,pmid-29269746,pmid-31126559,pmid-31869820,pmid-35785965,pmid-40611569,pmid-9972494}.md`
- `packages/health-commons/content/changes/2026-04.jsonl`
- directly coupled `packages/health-commons/generated/{catalog.hash,catalog.json,entities.ndjson,recent-changes.json}`
- directly coupled `apps/web/src/lib/health-commons/experiment-detail.ts` only for honest research-count/stat projection when mixed Bryan source provenance would otherwise inflate user-facing study labels
- directly coupled `apps/web/test/health-commons-experiment-detail-page.test.ts` only if required to match the regenerated Bryan Johnson protocol projection

## Constraints

- Do not widen into schema, contracts, or UI work; any `apps/web` change must stay limited to the directly coupled experiment-detail projection and its matching test so mixed Bryan source provenance does not inflate user-facing study labels or evidence stats.
- Preserve unrelated dirty-tree edits outside this lane, especially the current `apps/web`, `vault-usecases`, and plan/ledger work already in flight.
- Regenerate coupled Health Commons outputs from the current tree instead of replaying stale generated hunks verbatim.

## Verification

- `pnpm typecheck`
- `pnpm --dir packages/health-commons verify`
- `pnpm --dir packages/health-commons test:coverage`
- `pnpm test:smoke`
- `bash scripts/workspace-verify.sh test:diff packages/health-commons`
- use focused direct readback for the Bryan Johnson protocol and newly cited source set if generated outputs or source coverage need a tighter proof loop
Status: completed
Updated: 2026-04-22
Completed: 2026-04-22
