# Raw Attachment Prompt Evidence

## Goal

Ensure assistant auto-reply prompts render landed raw attachment evidence even when the attachment is not an image or PDF and has no parsed text.

Success criteria:

- Raw non-PDF/non-image attachments with stored paths appear in the prompt.
- Descriptor-only attachment inputs still render evidence status.
- Prompt wording distinguishes projection missing, raw missing, raw landed with pending or unsupported parser output, and parsed text availability.

## Constraints

- Keep the behavior change local to assistant-engine prompt construction and focused tests.
- Preserve existing parser-status wording and add generic raw-file guidance without weakening PDF-specific guidance.
- Preserve unrelated dirty working-tree edits and active plan rows.

## Plan

1. Inspect current attachment prompt rendering and tests.
2. Render generic raw stored paths and broader attachment-section eligibility.
3. Add focused tests for raw landed, raw missing, pending/unsupported status, and descriptor-only evidence.
4. Run scoped tests/typecheck plus required reviews.
5. Commit scoped changes if the tree allows a safe commit.

## Verification

- PASS: `pnpm -C packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-automation-prompt-builder.test.ts` (27 tests).
- PASS: `pnpm -C packages/assistant-engine typecheck`.
- PASS: `pnpm typecheck`.
- PASS: `git diff --check -- packages/assistant-engine/src/assistant/automation/prompt-builder.ts packages/assistant-engine/test/assistant-automation-prompt-builder.test.ts agent-docs/exec-plans/active/2026-05-04-raw-attachment-prompt-evidence.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- FAIL, unrelated/overlap: `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/automation/prompt-builder.ts packages/assistant-engine/test/assistant-automation-prompt-builder.test.ts` reached `packages/assistant-engine test` and failed in concurrent filename/evidence expectations outside this raw prompt slice, including `packages/assistant-engine/test/assistant-attachment-evidence-model.test.ts` expecting `Attachment image 1.` while the active filename row returns `Attachment image 1 (01__meal.jpg).`.
- PASS with threshold caveat: single-file coverage command ran the prompt-builder tests green, but package-wide coverage thresholds fail when only one file is selected.
- Security/privacy review: one raw-path prefix guard finding was applied; filename prompt exposure is owned by the separate active assistant attachment filenames row.
- Coverage-write review: added parsed-text prepared-path coverage and reran focused prompt-builder tests/typecheck.
- Task-finish review: no findings.

## Handoff Notes

- Raw `storedPath` prompt rendering is now generic but guarded to `raw/assistant-input/` and `raw/inbox/`.
- Metadata-only prepared sections now stay visible for raw landed, raw missing, parser status, rich image, and derived-evidence cases.
- Generic raw-file instruction is additive; PDF-specific instruction remains an extra specialization.
- Scoped commit is blocked by overlapping active dirty work in `prompt-builder.ts` and `assistant-automation-prompt-builder.test.ts` from the assistant attachment filenames row; do not partial-stage these files without coordinating that row.

Status: handoff
Updated: 2026-05-04
