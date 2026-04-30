# Biomarker About Content Hookup

## Goal

Render the three-column biomarker "About" intro from Health Commons biomarker markdown frontmatter instead of the temporary app-local lookup.

## Scope

- Add or use a typed Health Commons biomarker model field for the about-section entries.
- Wire `apps/web` biomarker detail pages to the model field.
- Remove the temporary `apps/web` shim.
- Preserve concurrent dirty-tree work and only stage this task's touched files.

## Success Criteria

- `/biomarkers/resting-heart-rate` renders the markdown-supplied "Why people care", "How to measure it", and "What moves it" content.
- The temporary app-local biomarker-about lookup is deleted.
- Focused tests cover the new data path.
- Required checks and completion audits are run or documented if blocked by unrelated dirty-tree state.

## Verification Plan

- Focused Health Commons/contracts tests for the biomarker about field.
- Focused hosted-web biomarker tests.
- Typecheck / diff-aware verification as far as the current dirty tree allows.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
