# Biomarker How-To-Read Ranges

## Goal

Update Health Commons biomarker explainer copy for eight marker pages so the `How to read it` guidance includes the requested ranges and interpretation context.

## Scope

- Edit only the requested biomarker markdown pages under `packages/health-commons/content/biomarkers`.
- Preserve unrelated dirty ledger and Norwegian 4x4 protocol work.

## Verification

- Run Health Commons generation and scoped checks for the touched biomarker pages.
- Run required content review passes before committing.

## State

- Done: updated the requested `How to read it` explainer copy on eight biomarker pages.
- Verification: `pnpm health-commons:generate`, `pnpm --dir packages/health-commons typecheck`, and diff hygiene passed.
- Blocked check: scoped `test:diff` reaches unrelated Health Commons catalog hash failure caused by pre-existing dirty `packages/health-commons/src/load.ts` parser behavior.
- Done: required coverage, security/privacy, and final review passes completed with no content changes needed.
- Now: close this plan and commit only the scoped biomarker pages.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
