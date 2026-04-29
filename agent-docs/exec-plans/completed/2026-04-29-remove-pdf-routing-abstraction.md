# Remove stale routingPdf abstraction from assistant inbox multimodal prompts

Status: completed
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Remove the stale `routingPdf` abstraction from assistant inbox multimodal preparation.
- Keep PDFs represented as ordinary stored inbox attachments with prompt-visible local `storedPath` metadata, not as native/rich routed evidence.

## Success criteria

- No `routingPdf`, `raw-pdf-disabled`, or `isRoutingPdfFallbackCandidate` code remains in assistant-engine.
- Image routing behavior remains unchanged.
- PDF attachment prompts still expose the stored local path as ordinary metadata.
- Focused assistant-engine tests pass.

## Scope

- In scope:
  - `packages/assistant-engine/src/inbox-model-contracts.ts`
  - `packages/assistant-engine/src/inbox-multimodal.ts`
  - directly coupled assistant-engine tests
- Out of scope:
  - Poppler parser implementation in `packages/parsers`
  - Codex App Server native `input_file`
  - eager PDF rendering/OCR

## Constraints

- Technical constraints:
  - Preserve unrelated dirty work in the same files.
  - Keep `routingImage` behavior intact.
- Product/process constraints:
  - PDFs remain untrusted local evidence, not instructions.

## Risks and mitigations

1. Risk: Removing PDF fallback eligibility accidentally skips attachment-only PDF prompts.
   Mitigation: Keep attachment metadata sections renderable when stored PDF metadata exists, and cover with tests.

## Tasks

1. Remove `routingPdf` schema/types/functions.
2. Update multimodal eligibility to image-only.
3. Preserve prompt metadata for PDF stored paths.
4. Update focused tests and run verification.

## Decisions

- `routingPdf` is misleading because Codex App Server does not route PDFs as native rich content in this path.
- The minimal primitive is existing inbox `storedPath` metadata.

## Verification

- Passed:
  - `pnpm --dir packages/assistant-engine exec vitest run test/inbox-multimodal.test.ts test/assistant-automation-prompt-builder.test.ts test/assistant-automation-support.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/assistant-engine test:coverage`
  - `git diff --check -- packages/assistant-engine/src/inbox-model-contracts.ts packages/assistant-engine/src/inbox-multimodal.ts packages/assistant-engine/src/assistant/automation/prompt-builder.ts packages/assistant-engine/test/inbox-multimodal.test.ts packages/assistant-engine/test/assistant-automation-prompt-builder.test.ts packages/assistant-engine/test/assistant-automation-support.test.ts agent-docs/exec-plans/active/2026-04-29-remove-pdf-routing-abstraction.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - `rg -n "routingPdf|raw-pdf-disabled|isRoutingPdfFallbackCandidate|MAX_INBOX_ROUTING_PDF|pdfEvidencePath|routingPdfPath" packages/assistant-engine/src packages/assistant-engine/test -g'*.ts'` returned no matches.
- Required audit passes:
  - `coverage-write` found no missing proof and made no edits.
  - `task-finish-review` found a metadata-only PDF prompt gap; fixed by making stored PDF metadata renderable without routed evidence and adding/updating tests.
Completed: 2026-04-29
