# Hosted Parser PDF Toolchain

## Goal

Make hosted assistant/parser runs expose the same local parser tools that the runner image installs, especially Poppler PDF text extraction.

Success criteria:

- Inbox parser doctor reports explicit PDF text-extraction tools instead of only audio tools.
- Hosted runner child env and Codex shell env preserve the parser executable selectors needed for PDF tooling.
- PDF document attachments can be parsed through a local Poppler-backed provider when `pdftotext`/`pdfinfo` are available.

## Constraints

- Preserve existing active Cloudflare runner and assistant-runtime edits.
- Do not allow member-controlled runner secrets to override executable selectors.
- Keep parser outputs derived/rebuildable only.

## Scope

- `packages/parsers/**`
- hosted runner/Codex env allowlists in `packages/assistant-runtime/**` and `apps/cloudflare/**`
- Dockerfile env defaults and directly coupled tests/docs only if required

## Verification

Focused verification is green for the touched parser/runtime/container surfaces:

- `pnpm --dir packages/parsers test -- parsers.test.ts parsers-coverage.test.ts`
- `pnpm --dir packages/parsers typecheck`
- direct assistant-runtime Vitest for `test/hosted-runtime-codex-config.test.ts` and `test/hosted-runtime-environment.test.ts`
- `pnpm --dir packages/assistant-runtime typecheck`
- app-local Cloudflare Vitest for runner child/env/container-image and hosted-runner-smoke contract tests
- `pnpm --dir apps/cloudflare test:e2e:linq-webhook:local`
- scoped `git diff --check`

Security and final review findings were addressed: Poppler PDF extraction now uses bounded page/input/output/process limits, `pdftotext` streams through stdout for live output caps, qpdf/mutool are exercised against the fixture, and the hosted smoke parses the fixture PDF through the real parser registry as `poppler.pdf`.

`pnpm --dir apps/cloudflare runner:docker:smoke` is still blocked before Docker build by unrelated runner-bundle TypeScript errors in active dirty-worktree export/contract work. The local webhook e2e is green.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
