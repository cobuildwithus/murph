# Add composable sample CSV profile and window summary primitives

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

Add a deterministic preview and interpretation layer on top of the existing generic sample CSV import path.

The current `samples import-csv` command is useful because it can save real device exports as normal canonical samples. The missing product primitive is a non-mutating way to inspect a file before writing, plus a reusable way to summarize a time window after planning or import. The assistant should not need to parse large CSV attachments manually or invent health-window math in chat.

The target shape is:

```sh
vault-cli samples csv profile <file> --vault <vault> --format json
vault-cli samples csv import <file> --vault <vault> --format json
vault-cli samples summarize --stream <stream> --from <ts> --to <ts> --format json
```

Keep the existing command as a compatibility wrapper:

```sh
vault-cli samples import-csv <file> --vault <vault> --format json
```

## Success criteria

- `samples csv profile` returns an import-plan-oriented profile without mutating the vault.
- The profile exposes row counts, blank rows, headers, timestamp inference, timezone assumption, timestamp range, sample interval, gaps, candidate streams, units, skipped-row counts, warnings, and source hints.
- Candidate source hints can recognize familiar export shapes, but they do not create device-specific canonical records or command families.
- `samples csv import` reuses the same planner and returns the same write receipt as `samples import-csv`, plus any profile fields that are safe and useful in an import receipt.
- Existing `samples import-csv` behavior and output compatibility remain intact, or any additive output changes are contract-compatible.
- `samples summarize` can summarize stored samples by stream and time window.
- The same summary engine can run on planned samples before write, so attachment flows can profile, summarize, decide, import, and re-summarize without bespoke parsing.
- SpO2 summaries support oxygen-night needs through generic threshold/run options or a `--profile oxygen-night` preset: min, max, average, sample count, range, gaps, time below thresholds, longest run below threshold, and cluster count.
- The assistant-facing JSON is compact enough to reason over directly and does not include raw file contents by default.
- Tests cover planner profiling, CLI command topology, compatibility behavior, stored-sample summary, pre-write planned-sample summary, SpO2 threshold/run detection, and timezone handling.

## Scope

In scope:

- `packages/importers`: CSV profiling, source-shape hints, planner result refactor, and pre-write summary input support.
- `packages/query`: stored-sample window summary helpers over the read model.
- `packages/cli`: new `samples csv profile`, `samples csv import`, and `samples summarize` command surfaces.
- `packages/operator-config`: output/input schemas for new CLI receipts.
- `packages/vault-usecases`: runtime/service types for importer and query helpers consumed by CLI.
- `packages/assistant-engine`: assistant CLI surface guidance only if command bootstrap text needs to teach the assistant to prefer profile/summarize over raw CSV parsing.
- `docs/contracts/03-command-surface.md`: command contract updates.
- Focused tests in the affected packages.

Out of scope:

- A dedicated O2Ring importer or durable O2Ring record family.
- A new top-level `timeseries` noun.
- New canonical sample storage format.
- Persisted derived `NightOxygenSummary` records in this pass.
- Clinical diagnosis logic. The output should provide deterministic data summaries and cautious interpretation fields, not medical diagnosis.
- Frontend UI.

## Current state

- `samples import-csv` already auto-detects recognizable metric columns when possible.
- The importer can map O2Ring-like `Oxygen Level` and `Pulse Rate` columns to `spo2` and `heart_rate` through generic aliases.
- `prepareCsvSampleImport` already reads the CSV, resolves timestamp and value columns, normalizes flexible timestamps using the vault timezone, skips blank rows, parses numeric suffixes, and builds per-stream payloads.
- The write path immediately calls core `importSamples`, which creates normal sample records, raw sample artifacts, manifest provenance, and audit entries.
- Query has daily sample summaries, but not arbitrary time-window summaries, threshold burden, run detection, or sleep-night-style windows.
- Inbox model attachment projection can summarize large tabular attachments for model context, but it is not an import planner and does not produce health-window summaries.

## Proposed design

### 1. Split profile, plan, write, and summary

Keep the canonical write boundary unchanged, but make the importer internals explicitly composable:

```ts
profileCsvSampleFile(input): Promise<CsvSampleFileProfile>
prepareCsvSampleImport(input): Promise<CsvSampleImportPlan>
importCsvSamples(input): Promise<CsvSampleImportResult>
summarizeSampleSeries(input): SampleWindowSummary
```

`prepareCsvSampleImport` can call `profileCsvSampleFile` internally. `importCsvSamples` can keep calling `prepareCsvSampleImport`.

The important change is that `profileCsvSampleFile` returns useful information before write, and `summarizeSampleSeries` accepts planned sample records as well as stored sample records.

### 2. Profile output shape

Initial JSON shape:

```json
{
  "vault": "<path>",
  "sourceFile": "<path>",
  "file": {
    "kind": "csv",
    "fileName": "export.csv",
    "byteSize": 990000,
    "delimiter": ",",
    "rowCount": 30010,
    "dataRowCount": 30009,
    "blankRowCount": 0
  },
  "columns": [
    { "name": "Time", "role": "timestamp", "index": 0 },
    { "name": "Oxygen Level", "role": "sample_value", "stream": "spo2", "unit": "%", "index": 1 },
    { "name": "Pulse Rate", "role": "sample_value", "stream": "heart_rate", "unit": "bpm", "index": 2 }
  ],
  "time": {
    "timeZone": "Asia/Kuala_Lumpur",
    "timestampColumn": "Time",
    "firstRecordedAt": "2026-04-16T16:55:47.000Z",
    "lastRecordedAt": "2026-04-17T01:16:00.000Z",
    "sampleIntervalSeconds": 1,
    "gapCount": 0,
    "gaps": []
  },
  "series": [
    {
      "stream": "spo2",
      "unit": "%",
      "valueColumn": "Oxygen Level",
      "importableCount": 30009,
      "skippedCount": 0,
      "minValue": 88,
      "maxValue": 99,
      "averageValue": 96.6,
      "confidence": 0.98
    }
  ],
  "sourceHints": [
    { "id": "wellue-o2ring-csv", "label": "O2Ring-style CSV", "confidence": 0.8 }
  ],
  "warnings": []
}
```

Privacy note: include `sourceFile` only because current command receipts already do. Do not include raw rows or full attachment text by default. Use existing path-redaction policies in assistant-facing prompts and logs.

### 3. Source hints, not device importers

Add lightweight `sourceHints` based on column/file-shape evidence:

- file name patterns such as `O2Ring`
- known column groups such as `Time`, `Oxygen Level`, `Pulse Rate`, `Motion`
- sample interval and value ranges that match an export family

Hints should be non-authoritative. They can raise mapping confidence or select a default metadata column, but they must not bypass the generic stream mapping. The durable records stay normal `samples`.

Keep the existing sample preset registry for explicit overrides. Consider default built-in presets only if they stay generic and optional.

### 4. Summary output shape

Add a pure numeric summary helper that accepts:

- `stream`
- `unit`
- samples with `recordedAt` and numeric `value`
- optional `from` / `to`
- optional thresholds
- optional gap interval
- optional summary profile

Generic output:

```json
{
  "stream": "spo2",
  "unit": "%",
  "from": "2026-04-16T16:55:47.000Z",
  "to": "2026-04-17T01:16:00.000Z",
  "sampleCount": 30009,
  "numericSampleCount": 30009,
  "firstSampleAt": "2026-04-16T16:55:47.000Z",
  "lastSampleAt": "2026-04-17T01:16:00.000Z",
  "durationSeconds": 30013,
  "sampleIntervalSeconds": 1,
  "minValue": 88,
  "maxValue": 99,
  "averageValue": 96.6,
  "thresholds": [
    {
      "below": 92,
      "sampleCount": 19,
      "durationSeconds": 19,
      "runCount": 2,
      "longestRunSeconds": 12
    }
  ],
  "gaps": [],
  "warnings": []
}
```

For `--profile oxygen-night`, default thresholds should be `92`, `90`, and `88`, and the receipt can include a conservative `screen` field:

```json
{
  "screen": {
    "profile": "oxygen-night",
    "level": "normal_oxygen_trace",
    "reasons": [
      "Time below 90% was brief.",
      "No sustained low-oxygen clusters were detected."
    ],
    "caveat": "This summarizes oxygen samples only and does not diagnose or rule out sleep apnea."
  }
}
```

The wording should stay data-first and avoid diagnosis claims.

### 5. Pre-write summary

Support pre-write summary in one of two ways:

Preferred first version:

```sh
vault-cli samples csv profile <file> --vault <vault> --include-summary --summary-profile oxygen-night --format json
```

This profiles the file, creates the same internal plan, summarizes each planned numeric series, and returns summaries without writing.

Stored-sample version:

```sh
vault-cli samples summarize --stream spo2 --from <ts> --to <ts> --profile oxygen-night --format json
```

This reads canonical samples from the vault and runs the same summary engine.

Avoid introducing a persisted plan id in this pass. The profile command can return enough plan detail for a same-turn assistant flow, and `samples csv import` can recompute deterministically with the same options.

## Command contract

Add a nested `samples csv` group:

```sh
vault-cli samples csv profile <file> --vault <path> [--preset <id>] [--stream <stream>] [--ts-column <name>] [--value-column <name>] [--unit <unit>] [--delimiter <char>] [--metadata-columns <name> ...] [--source <source>] [--include-summary] [--summary-profile <profile>] [--threshold-below <n> ...] [--request-id <id>]
vault-cli samples csv import <file> --vault <path> [same import options as import-csv] [--request-id <id>]
vault-cli samples summarize --vault <path> --stream <stream> --from <ts> --to <ts> [--profile <profile>] [--threshold-below <n> ...] [--gap-seconds <n>] [--limit <n>] [--request-id <id>]
```

Compatibility:

- Keep `samples import-csv` routed to the new `samples csv import` handler or shared helper.
- Do not remove or rename existing output fields.
- Add new fields only where schema-compatible and useful.

Use real incur nested commands. Do not simulate `csv` as a positional action.

## Implementation tasks

1. Define contracts.
   - Add profile and summary schemas in `packages/operator-config/src/vault-cli-contracts.ts`.
   - Add runtime types in `packages/vault-usecases/src/usecases/types.ts`.
   - Keep path fields as existing `pathSchema` output fields.

2. Add importer profile types.
   - Add `CsvSampleFileProfile`, `CsvSampleSeriesProfile`, `CsvSampleTimeProfile`, `CsvSampleColumnProfile`, `CsvSampleSourceHint`, and warning types under `packages/importers/src/csv-sample-import-planner.ts` or a new sibling module if the planner gets too large.
   - Reuse existing delimiter parsing and timestamp normalization logic.
   - Return compact counts and examples only; avoid raw-row payloads.

3. Refactor planner internals.
   - Make `prepareCsvSampleImport` consume the profile where possible.
   - Preserve exact import behavior and existing tests.
   - Keep ambiguity failures for true conflicts, but make profile able to report ambiguous candidates without throwing when the caller only wants preview.

4. Add source hints.
   - Implement simple deterministic heuristics for O2Ring-style CSV as a hint.
   - Keep hints additive and non-authoritative.
   - Add confidence numbers only if they are stable and documented in tests.

5. Add pre-write summary helper.
   - Implement `summarizeSampleSeries` in a package that both importer pre-write and query post-write paths can use without creating an upward dependency.
   - Likely owner: `packages/importers` for planned samples plus `packages/query` adapter for stored samples, or a small shared helper in `packages/contracts` only if it stays pure and contract-oriented.
   - Avoid making `query` depend on `importers`.

6. Add stored-sample summary query.
   - Add query helper that reads samples by stream and timestamp window.
   - Convert `CanonicalEntity` sample records into the pure summary helper input.
   - Return deterministic errors for missing stream, no samples, or invalid window.

7. Add CLI commands.
   - Add `samples csv profile`.
   - Add `samples csv import`.
   - Keep `samples import-csv` as a wrapper around the shared import helper.
   - Add `samples summarize`.
   - Normalize repeatable `--threshold-below` flags using existing repeatable-flag helpers.

8. Update assistant guidance if needed.
   - Teach the assistant to prefer `samples csv profile` for large health CSV attachments before raw parsing.
   - Teach it to use `samples summarize --profile oxygen-night` for oxygen-window questions after import.

9. Update docs.
   - Update `docs/contracts/03-command-surface.md` with command grammar and sample JSON receipts.
   - Update `ARCHITECTURE.md` only if ownership or control-flow rules materially change. The expected design should not require architecture changes.

10. Refresh generated CLI metadata.
   - Run the repo's incur generation path for `packages/cli/src/incur.generated.ts` if command topology changes require it.
   - Keep generated changes scoped to the command surface.

## Testing plan

Importer tests:

- `profileCsvSampleFile` detects headers, row counts, blank rows, timestamp range, interval, gaps, SpO2 and heart-rate candidates.
- Profile handles O2Ring-style timestamp strings using the vault timezone.
- Profile reports ambiguous columns without writing.
- `prepareCsvSampleImport` preserves existing import behavior.
- `importCsvSamples` still imports multiple recognizable streams.

Summary tests:

- Numeric summary computes count, min, max, average, first/last, duration, and interval.
- Threshold summary computes time below threshold, run count, and longest run.
- Gaps break runs where appropriate.
- `oxygen-night` profile applies default thresholds and conservative screen labels.
- Empty windows and invalid windows return predictable errors.

CLI tests:

- `samples csv profile --schema` exposes the new command.
- `samples csv profile` returns compact profile JSON and does not create sample ledgers or raw sample manifests.
- `samples csv profile --include-summary --summary-profile oxygen-night` summarizes planned samples without writing.
- `samples csv import` writes the same records and manifests as `samples import-csv`.
- `samples import-csv` remains compatible.
- `samples summarize` reads stored samples and returns the same summary math as the pre-write path.

Regression tests:

- Existing O2Ring-style importer tests still pass.
- Existing sample batch manifest provenance tests still pass.
- Existing `samples batch show/list`, `samples list`, and timeline daily summary behavior stays unchanged.

## Verification

Likely commands after implementation:

```sh
pnpm typecheck
pnpm test:diff packages/importers/src packages/importers/test packages/query/src packages/query/test packages/cli/src packages/cli/test packages/operator-config/src packages/vault-usecases/src docs/contracts/03-command-surface.md
pnpm --dir packages/importers test:coverage
pnpm --dir packages/query test:coverage
pnpm --dir packages/cli verify:coverage
pnpm test:smoke
git diff --check
```

If the diff stays narrow and `pnpm test:diff` truthfully covers the package owners, prefer it over running every package-local coverage command separately. If repo-wide checks are already red for unrelated active rows, use scoped verification per `agent-docs/operations/verification-and-runtime.md` and record the exact blocker.

## Risks and mitigations

1. Risk: adding `samples csv` creates duplicate command semantics.
   Mitigation: keep `samples csv import` and `samples import-csv` on the same helper and document `import-csv` as compatibility.

2. Risk: profile output becomes too verbose for assistant use.
   Mitigation: default to compact aggregate fields, no raw rows, bounded gaps/warnings, and optional verbose/debug fields only if needed later.

3. Risk: source hints become hidden device-specific import behavior.
   Mitigation: keep hints informational unless an explicit preset or override chooses behavior. Store only normal sample streams.

4. Risk: pre-write and post-write summaries drift.
   Mitigation: put the math in one pure helper and adapt both planned samples and stored samples into that input shape.

5. Risk: threshold run detection over irregular samples is misleading.
   Mitigation: include interval and gap metadata, break runs across gaps, and report warning flags when timing quality is weak.

6. Risk: oxygen-night summary sounds diagnostic.
   Mitigation: return data-first screen labels and caveats. Assistant guidance should say this summarizes oxygen samples only.

7. Risk: file paths or raw attachment text leak into assistant-visible receipts.
   Mitigation: keep receipts compact, follow existing path output conventions, and do not include raw rows or full source text.

## Decisions

- Use `samples`, not a new top-level `timeseries` noun.
- Keep O2Ring as a source hint or optional preset, not a dedicated importer.
- Keep canonical records as normal sample records.
- Add profile and summary layers around the existing importer/core/query boundaries.
- Support pre-write summary through `samples csv profile --include-summary` rather than persisted plan ids in the first pass.

## Open questions

- Should `sourceHints` include confidence numbers in v1, or only ordered hint ids plus reasons?
- Should `samples summarize --profile oxygen-night` infer the window from a date and vault timezone later, or require explicit `--from` and `--to` for v1?
- Should threshold duration be sample-count-based for regular intervals, interval-weighted for irregular samples, or both?
- Should `samples csv profile` expose a bounded `sampleRows` preview for operator debugging, or keep row samples out of v1?

## Implementation notes

- Implemented `profileCsvSampleFile`, `samples csv profile`, `samples csv import`, and `samples summarize`.
- Added shared window-summary math for planned samples and stored samples.
- Kept O2Ring recognition as a source hint only.
- Kept `samples import-csv` as the compatibility import path.
- Updated command-surface docs, CLI schemas, generated incur metadata, and focused tests.
- Full root/diff verification is currently blocked by unrelated assistant input-store type errors in the dirty worktree; focused owner checks are recorded in handoff.
Completed: 2026-04-30
