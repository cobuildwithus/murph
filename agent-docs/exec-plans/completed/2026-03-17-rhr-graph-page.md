# 2026-03-17 RHR Graph Page

## Goal

Add a canonical markdown-backed health-library graph slice for resting heart rate and render it through a dedicated, high-quality local web page.

## Scope

- `packages/contracts`: health-library graph entity definitions/types
- `packages/query`: graph loaders and a focused RHR page read model
- `fixtures/demo-web-vault`: RHR-linked canonical pages, protocols, and sources
- `packages/web`: dedicated RHR route, supporting styles/tests, and a homepage entry point if needed

## Constraints

- Keep canonical truth on disk and use the query/web layers as read-only materializations.
- Preserve current dirty web work and avoid reverting unrelated edits.
- Do not expose raw vault paths or direct personal identifiers in rendered payloads.

## Plan

1. Define a small graph entity model that distinguishes domains, biomarkers, goal templates, protocol variants, and source records.
2. Seed the demo vault with an RHR biomarker page plus linked graph nodes derived from the provided spec/doc.
3. Expose a dedicated RHR read model in query and build a distinctive page in the local web app.
4. Add focused tests, run required verification, then run completion-workflow audits before handoff.
Status: completed
Updated: 2026-03-17
Completed: 2026-03-17
