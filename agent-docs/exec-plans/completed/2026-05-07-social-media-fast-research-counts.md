# Social Media Fast Research Counts

## Goal

Resolve the Social Media Fast mismatch where the experiment browse card reports a broad source-snippet count as studies while the detail research tab shows only the curated direct/review evidence set, and recover structured participant evidence where source data supports it.

## Scope

- Health Commons experiment browse count semantics.
- Social Media Fast source frontmatter evidence coding for curated direct sources.
- Generated web artifact verification for Social Media Fast.
- ReviewGPT fanout artifacts under the ignored Social Media Fast research workspace.

## Constraints

- Do not broaden efficacy claims beyond the conservative protocol language.
- Do not invent participant counts; only code counts explicit in source metadata/extracted records.
- Keep broad recall corpus distinct from direct/appraised research evidence.
- Preserve unrelated working tree and ledger edits.

## Current State

- Found staged Social Media Fast recovery with 179 extracted records, 176 selected candidates, and zero unresolved extraction gaps.
- Found browse card count comes from route `sourceSnippets` journal/review sources, not the curated detail research source set.
- Sent three ReviewGPT audit threads: participant/frontmatter coding, research-tab integration/count semantics, and missing direct-source recall.

## Verification Plan

- Regenerate Health Commons web artifacts after code/content changes.
- Run focused tests/typecheck required by Health Commons/web artifact changes.
- Inspect Social Media Fast generated browse and research JSON for aligned counts and participant stats.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
