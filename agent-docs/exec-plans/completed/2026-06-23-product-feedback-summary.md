# Product feedback summary

## Goal

Replace hosted product-feedback `topic` with a bounded sanitized `summary` field.

Success criteria:
- `murph.submit_product_feedback` accepts `kind`, `summary`, and optional validated changelog item ids.
- Hosted persistence stores `summary` and no longer stores or exports `topic`.
- Prompt/tool guidance allows concise product-feature summaries while still banning raw conversation text, health details, identifiers, contact details, secrets, provider payloads, and tags.
- Focused parser, assistant, web, and Cloudflare tests cover the new contract.

## Constraints

- Preserve explicit-user-signal requirement for feedback capture.
- Keep persisted summaries bounded and product-only.
- Do not reintroduce feedback tags.
- Preserve unrelated working-tree edits.

## Scope

- `packages/hosted-execution` product-feedback contract/parser/tests.
- `packages/assistant-engine` dynamic tool, prompt/automation guidance, idempotency, and tests.
- `apps/web` Prisma schema/migration, persistence, export, docs/tests.
- `apps/cloudflare` product-feedback fixtures.

## Verification

- PASS: `pnpm --dir packages/hosted-execution test -- test/product-feedback-contract.test.ts`
- PASS: `pnpm --dir packages/assistant-engine test -- test/assistant-product-feedback.test.ts test/model-behavior.test.ts test/managed-automations.test.ts test/managed-automations-core.test.ts`
- PASS: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-product-feedback-service.test.ts apps/web/test/hosted-product-feedback-route.test.ts apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
- PASS: `pnpm --dir apps/cloudflare test:node -- apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/runner-platform.test.ts`
- PASS: affected typechecks for `packages/hosted-execution`, `packages/assistant-engine`, `apps/web`, and `apps/cloudflare`.
- PASS: `pnpm test:diff` before later unrelated Codex-runtime dirty edits appeared in the checkout.
- BLOCKED: final `pnpm test:diff` rerun after the accepted security fix failed in unrelated dirty `packages/assistant-runtime` Codex config tests, outside this product-feedback scope.

## Audits

- `prompt-review`: no findings; residual prompt risk is model-authored summary semantics.
- `security-privacy-review`: accepted finding that summary text in the idempotency key could persist duplicate differently worded summaries; fixed by deriving the key from accepted input ids, kind, and changelog ids only. Narrow re-review found no remaining medium-or-higher issues.
- `coverage-write`: added missing-summary and summary-bound proof in parser/tool/web tests.
- `deep-review`: no verified blocking code findings; noted the hard-cut deploy risk.

## Notes

- `summary` is nullable in the database for existing rows but required in new runtime/tool payloads.
- The deployment order needs a compatibility note because old web/runtime versions disagree on `topic` vs `summary`.
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
