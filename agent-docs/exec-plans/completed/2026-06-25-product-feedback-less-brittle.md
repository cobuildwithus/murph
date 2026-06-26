# Product feedback less brittle

## Goal

Make hosted product-feedback capture less brittle while preserving the privacy boundary.

Success criteria:

- `murph.submit_product_feedback` can record product interest even when no changelog card id applies.
- Changelog ids remain optional metadata and are still server-validated when present.
- Persisted summaries are bounded, product-only, and deterministically scrub high-confidence contact/secret tokens before database writes.
- Focused contract, assistant-tool, and hosted-web tests cover the change.

## Constraints

- Keep hosted web as the durable product-feedback persistence owner.
- Do not store raw user wording, raw conversation text, health details, identifiers, contact details, secrets, provider payloads, tags, topics, or unrelated context.
- Do not add a new runtime model call unless the deterministic boundary is insufficient.
- Privacy Filter was checked as an OpenAI open-weight local redaction model, not a currently exposed Workers AI catalog model.

## Working Set

- `packages/hosted-execution/src/runtime-control.ts`
- `packages/hosted-execution/src/parsers/runtime-control.ts`
- `packages/hosted-execution/test/product-feedback-contract.test.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/test/assistant-product-feedback.test.ts`
- `packages/assistant-engine/test/model-behavior.test.ts`
- `apps/web/src/lib/hosted-execution/product-feedback.ts`
- `apps/web/test/hosted-product-feedback-service.test.ts`
- `apps/web/test/hosted-product-feedback-route.test.ts`
- `agent-docs/SECURITY.md`

## Verification Plan

- `pnpm --dir packages/hosted-execution test -- test/product-feedback-contract.test.ts`
- `pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts --no-coverage packages/assistant-engine/test/assistant-product-feedback.test.ts packages/assistant-engine/test/model-behavior.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-product-feedback-service.test.ts apps/web/test/hosted-product-feedback-route.test.ts apps/web/test/hosted-account-data-service.test.ts`
- `pnpm typecheck`

## State

- Read required repo docs and relevant security/product-feedback code paths.
- OpenAI Privacy Filter and Cloudflare Workers AI catalog checked from official docs/search.
- Implementation updated shared contract parsing, assistant dynamic-tool parsing/guidance, web persistence normalization, security docs, and focused tests.
- Hosted-execution focused product-feedback contract command passed.
- Focused assistant product-feedback/model-behavior vitest passed.
- Focused hosted-web product-feedback/account-data vitest passed.
- `pnpm typecheck` passed after waiting for the workspace verification lock.
- `git diff --check` passed.
- Broad assistant-engine package test command hit unrelated assistant-codex-runtime failures outside the product-feedback path; focused assistant coverage passed.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
