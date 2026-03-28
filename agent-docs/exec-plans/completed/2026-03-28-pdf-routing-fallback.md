# PDF Routing Fallback

Status: completed
Updated: 2026-03-28
Completed: 2026-03-28

## Goal

Implement shared local/hosted inbox-routing behavior that keeps `pdftotext` as the first-pass PDF parser, removes Paddle from the active PDF path, and sends raw PDF file parts to supported models only when parsed PDF text is unavailable.

## Scope

- Active parser-registry construction under `packages/parsers/src/**`
- Inbox model routing message assembly under `packages/cli/src/**`
- Focused parser and inbox-routing regression tests

## Constraints

- Preserve existing direct-vision routing for supported image attachments.
- Keep parser-wait behavior unchanged: pending/running non-image attachments still block routing.
- Use raw PDFs only as fallback for parse-failed or no-text PDF cases.
- Preserve adjacent dirty-tree edits and avoid unrelated setup/install/docs churn in this pass.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Focused package tests while iterating: parser and CLI routing/provider coverage

## Notes

- Hosted execution shares the same parser/routing seams as local `assistant run`, so this change intentionally applies to both.
- Repo verification uncovered an unrelated but blocking CLI runtime failure: `@murph/runtime-state` eagerly re-exported `@murph/hosted-execution`, causing non-hosted CLI commands to fail module resolution. Fix that export surface narrowly in this lane by removing the eager root re-export so the required checks reflect the PDF routing change truthfully.

## Outcome

- Kept `pdftotext` as the active first-pass PDF parser, removed Paddle from the live PDF path, and added raw-PDF fallback only when parsed text is unavailable.
- Shared the routing behavior across local and hosted inbox execution without changing the existing image-routing path.
- Removed the eager `@murph/hosted-execution` re-export from `@murph/runtime-state` so non-hosted CLI entrypoints stop paying that module-resolution cost.
