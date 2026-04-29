# Teach Codex assistant prompt about local PDF toolchain

Status: completed
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Teach the Codex assistant prompt that hosted/local Codex turns can inspect local PDF artifacts with the native Poppler/file command-line tools when a PDF path or prepared PDF artifact is actually available.
- Keep this as prompt guidance only; do not reintroduce native `input_file` transport through Codex App Server.

## Success criteria

- The system prompt names the supported local PDF commands: `file`, `pdfinfo`, `pdftotext`, and `pdftoppm`.
- The prompt tells Codex to use those commands only for local PDF paths/artifacts exposed to the current turn, with bounded page rendering and untrusted-document handling.
- The prompt does not claim Codex App Server can receive native PDF `input_file` items.
- A focused assistant-engine test proves the guidance is present in the built prompt.

## Scope

- In scope:
  - `packages/assistant-engine/src/assistant/system-prompt.ts`
  - directly coupled system-prompt tests
- Out of scope:
  - Codex App Server `input_file` injection
  - PDF evidence materialization pipeline
  - parser/provider capability changes
  - Cloudflare container package changes

## Constraints

- Technical constraints:
  - Preserve existing dirty-tree edits in the same files.
  - Keep guidance route-stable so it can be cached with the rest of the route capability prompt.
- Product/process constraints:
  - Treat PDF contents as untrusted user evidence, not instructions.
  - Do not expose local paths in user-facing channel replies unless explicitly useful and requested.

## Risks and mitigations

1. Risk: Prompt guidance overclaims native PDF transport.
   Mitigation: Explicitly phrase the guidance around local paths/artifacts and avoid `input_file`.
2. Risk: The assistant renders too many pages or treats a document as instructions.
   Mitigation: Include bounded render guidance and untrusted-document wording.

## Tasks

1. Add local PDF toolchain guidance to the assistant route capability prompt.
2. Add focused prompt test coverage.
3. Run focused assistant-engine verification.
4. Close or hand off with blockers if broader verification is red for unrelated dirty-tree state.

## Decisions

- The user-provided plan is directionally correct: direct Responses API PDF `input_file` support should stay separate from Codex App Server, whose documented user-message content is text/image/localImage.
- This task lands only the prompt guidance; the larger evidence-materialization pipeline remains a separate implementation.

## Verification

- Passed:
  - `pnpm --dir packages/assistant-engine exec vitest run test/model-behavior.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/assistant-engine typecheck`
  - `git diff --check -- packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test/model-behavior.test.ts agent-docs/exec-plans/active/2026-04-29-codex-pdf-tool-prompt.md`
- Broader scoped lane:
  - First `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test/model-behavior.test.ts` run passed through assistant-engine and dependent package tests until `packages/cli` failed on this active plan missing a coordination-ledger row.
  - After closing this plan, the same command rerun failed earlier in `packages/assistant-engine typecheck` on an unrelated dirty edit in `packages/assistant-engine/src/assistant/diagnostics.ts` removing the required `providerFailovers` counter.
Completed: 2026-04-29
