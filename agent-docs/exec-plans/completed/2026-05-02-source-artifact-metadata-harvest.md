# Source Artifact Metadata Harvest

## Goal

Harvest the supplied ChatGPT source-extraction batch threads and update the referenced Health Commons source artifacts with accurate `source.authors` and `source.journal` values.

## Scope

- Supplied ChatGPT threads for Hercules, Phlebas, and Vonneumann batches.
- Referenced Health Commons source pages under `packages/health-commons/content/sources/**`.
- Focused Health Commons validation and catalog generation only when required to prove source metadata parsing.

## Constraints

- Preserve unrelated dirty work and active Health Commons rows.
- Keep harvest downloads under ignored `output-packages/**`.
- Do not touch generated Health Commons artifacts unless verification requires it.
- Do not expose local personal identifiers in docs, diffs, logs, or handoff.

## Current Read

- The requested thread URLs are not currently recorded in existing research workspace state.
- The source artifact pages are repo-tracked Health Commons content, so this follows the repo plan and commit workflow rather than the vault-only data path.
- Twelve supplied CSV downloads completed successfully and are the source of truth for this pass.
- Hercules batch 17 and Vonneumann batches 4 and 12 failed inside ChatGPT with `Thinking failed`; rows from those thread prompts were matched by title and resolved from completed duplicate rows, local duplicate source metadata, or public identifier records where needed.
- CSV rows use `study_title` as the source-page match key and `authors` / `journal` as the fields to land.
- Placeholder author rows such as `Health Commons (unresolved)` are skipped.
- Duplicate title rows are applied when their journal normalizes to the same publication label or a source URL/domain disambiguates the publication surface.

## Progress

- Mapped CSV schema and source markdown format.
- Harvested completed CSVs under ignored `output-packages/thread-harvest/**`.
- Applied title-matched `source.authors` / `source.journal` updates across referenced source artifacts under `packages/health-commons/content/sources/**`.
- Confirmed the matched thread-referenced source set has zero remaining placeholder/missing `source.authors` or `source.journal` values.
- After final-review findings, corrected ClinicalTrials.gov source pages to use registry sponsor/`ClinicalTrials.gov` metadata and corrected the LinkedIn platform label.
- Ran a full touched-source audit across 1,093 modified source pages: zero remaining missing/generic author/journal fields and no unresolved platform/source-domain mismatches.

## Verification Target

- Touched source pages parse through the Health Commons content reader.
- `authors` and `journal` are present and non-placeholder for every source artifact referenced by the harvested batches where the thread provides those fields.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
