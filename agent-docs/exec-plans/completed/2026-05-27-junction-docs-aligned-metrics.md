# Junction Docs-Aligned Metrics

## Goal

Map current Junction summary payload fields into existing compact wearable observations so CLI/query surfaces can read high-value metrics without parsing raw timeseries.

## Scope

- `packages/importers/src/device-providers/junction.ts`
- Focused Junction importer tests
- Focused wearable query surface test
- `ARCHITECTURE.md` boundary note

## Constraints

- Keep raw Junction timeseries evidence-only.
- Do not add query-runtime raw artifact parsing.
- Reuse existing canonical wearable metrics and unit normalization.
- Avoid speculative new metrics unless the existing catalog already owns them.

## Verification

- Focused importer tests for docs-shaped Junction summaries.
- Package/diff verification required by the workflow.
Status: completed
Updated: 2026-05-27
Completed: 2026-05-27
