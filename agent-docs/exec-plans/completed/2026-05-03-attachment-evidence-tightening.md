# Tighten Assistant Attachment Evidence

Status: completed
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Fix the low-complexity issues found after the inbox-decouple hard cut without changing the core architecture.
- Preserve event-owned attachment evidence, prompt-side source neutrality, and producer-only inbox access.

## Success Criteria

- Safe `raw/inbox/**` PDF refs render as inspectable prompt metadata.
- Parser-drain evidence refresh preserves event descriptor attachment ids.
- Prompt-side image evidence read failures emit safe nonblocking progress events.
- Assistant-owned `raw/assistant-input/**` artifact copies are documented as an explicit namespace rather than an ad hoc pattern.
- Focused tests and typecheck pass.

## Scope

- In scope: assistant-engine evidence materialization, prompt builder, local producer refresh hooks, focused tests, and minimal docs/comments.
- Out of scope: typed hosted post-checkpoint effect framework, JSON summarization for inline evidence, broad hosted runner refactors, and unrelated dirty work.

## Verification

- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-attachment-evidence-model.test.ts test/assistant-automation-prompt-builder.test.ts test/assistant-automation-runtime.test.ts test/assistant-input-attachment-evidence-store.test.ts`
- Passed: `pnpm --dir packages/assistant-engine typecheck`
- Passed: `pnpm --dir packages/assistant-engine test:coverage`
- Passed: `git diff --check`
- Passed: prompt-inbox residue scan and scoped privacy scan.
- Attempted: `pnpm typecheck`; blocked by unrelated dirty hosted-runtime/app type errors outside this plan.
- Attempted: `bash scripts/workspace-verify.sh test:diff ...`; assistant-engine, assistant-runtime, assistantd, CLI, and setup-cli portions passed, then apps/cloudflare verify failed on unrelated dirty hosted-runtime/cloudflare type errors outside this plan.
Completed: 2026-05-03
