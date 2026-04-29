# Add minimum Poppler tooling to hosted Cloudflare runner

Status: completed
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Add the minimum native PDF inspection/extraction/rendering toolchain to the hosted Cloudflare runner base image.
- Keep this as an image/tooling capability only; do not reintroduce a durable PDF parser provider or change hosted PDF product behavior in this task.

## Success criteria

- `Dockerfile.cloudflare-hosted-runner-base` installs `poppler-utils` and `file`.
- The final hosted runner Docker smoke proves `pdfinfo`, `pdftotext`, `pdftoppm`, and `file` work against the existing `raw/smoke/hosted-runner.pdf` fixture.
- Docs describe Poppler as available in the base image without claiming durable PDF parsing behavior changed.
- Focused Cloudflare tests and Docker smoke are run or blockers are recorded.

## Scope

- In scope:
  - `Dockerfile.cloudflare-hosted-runner-base`
  - hosted runner smoke contract/child code and directly coupled tests
  - Cloudflare deploy/runtime docs that describe the native base image and smoke proof
- Out of scope:
  - Cloudflare container sizing
  - `packages/parsers` PDF provider work
  - OCR/Tesseract/OCRmyPDF
  - `qpdf`
  - hosted Codex PDF evidence behavior changes

## Constraints

- Technical constraints:
  - Keep native installs in the stable base image; final and smoke app-layer Dockerfiles stay app-only.
  - Use the existing restored fixture PDF instead of generating PDFs in smoke code.
  - Do not add hosted per-user executable selector env vars.
- Product/process constraints:
  - Preserve unrelated dirty work in the shared checkout.
  - Because this touches hosted runner/deploy tooling, run the required completion workflow audits unless blocked.

## Risks and mitigations

1. Risk: Adding the binaries without proof leaves the deployed image contract stale.
   Mitigation: Extend the existing final-image Docker smoke to execute Poppler commands against a real fixture.
2. Risk: The change is mistaken for durable PDF parsing behavior.
   Mitigation: Keep parser code untouched and document the capability as image tooling only.
3. Risk: Overlapping active Cloudflare runner edits make a scoped commit unsafe.
   Mitigation: Keep the touched diff narrow and record any safe-commit blocker before handoff.

## Tasks

1. Install `poppler-utils` and `file` in the hosted runner base image.
2. Add direct Poppler/file checks to the hosted runner smoke child.
3. Update directly coupled contract tests and docs.
4. Run focused verification and required audits.
5. Close the plan; commit only if the scoped diff can be safely isolated from overlapping dirty work.

## Decisions

- Use Option A only: install and prove the binaries, with no parser/product behavior change.
- Skip `qpdf`; it is not needed for the minimum install.
- Reuse `fixtures/demo-web-vault/raw/smoke/hosted-runner.pdf`.

## Verification

- Commands to run:
  - `pnpm --dir apps/cloudflare test -- container-image-contract.test.ts hosted-runner-smoke.test.ts hosted-runner-smoke-contract.test.ts`
  - `pnpm --dir apps/cloudflare runner:docker:smoke`
  - `pnpm --dir apps/cloudflare verify`
  - `pnpm typecheck`
- Expected outcomes:
  - Focused tests pass.
  - Docker smoke reports hosted runner proof and fails if Poppler/file tooling is missing or broken.
- Results:
  - Passed: `pnpm --dir apps/cloudflare test -- container-image-contract.test.ts hosted-runner-smoke.test.ts hosted-runner-smoke-contract.test.ts` (app-local typecheck first, then 60 test files / 604 tests passed).
  - Blocked before Docker run: `pnpm --dir apps/cloudflare runner:docker:smoke` failed during runner bundle build on unrelated `packages/assistant-engine/src/assistant/active-turn-input-controller.ts` TypeScript error: `Property 'finally' does not exist on type '() => Promise<void>'`.
  - Blocked: `pnpm --dir apps/cloudflare verify` failed on the same unrelated `active-turn-input-controller.ts` TypeScript error.
  - Blocked: `pnpm typecheck` failed on the same unrelated `active-turn-input-controller.ts` TypeScript error.
Completed: 2026-04-29
