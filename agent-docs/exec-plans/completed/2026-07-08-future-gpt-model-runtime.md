# Future GPT Model Runtime Config

## Goal

Prepare hosted runtime configuration so production can flip from `gpt-5.5` to future GPT model slugs, especially `gpt-5.6-terra`, by environment once the provider accepts the model IDs.

Success criteria:

- Hosted AI usage allowance accepts the future model slugs as priced direct OpenAI models.
- Usage accounting has deterministic standard and OpenAI flex token pricing for each new slug.
- OpenAI flex remains evidence-gated and works for the new slugs when the provider and service tier prove it.
- Hosted deploy preflight allows the prepared production model switch without allowing unpriced models.
- The hosted runner Codex model catalog exposes the prepared slugs with flex service-tier support until the bundled catalog contains them.
- Focused tests, typecheck, PR, ReviewGPT loop, and CI are completed before handoff.

## Constraints

- Keep changes narrow and preserve the existing hosted execution ownership boundaries.
- Do not invent public OpenAI availability claims for unreleased models; treat prepared slugs as Murph runtime configuration until launch.
- Do not weaken production runtime, pricing, provider-evidence, or deploy-preflight invariants.
- Use the existing usage allowance, runtime-control, deploy-preflight, and Codex catalog patch primitives.

## Current State

- `gpt-5.5` is the only priced hosted AI usage allowance model.
- OpenAI flex pricing is supported only for `gpt-5.5`.
- Production deploy preflight requires `HOSTED_ASSISTANT_MODEL=gpt-5.5`.
- The hosted runner Dockerfile patches the bundled Codex catalog to add `gpt-5.5` flex and `gpt-5.4-nano` deploy smoke support.

## Plan

1. Add future model slugs to hosted runtime accepted-model and OpenAI-flex eligibility lists.
2. Add standard and flex usage allowance pricing entries with explicit pricing-version metadata.
3. Update deploy preflight to allow the prepared production switch while preserving priced-model validation.
4. Patch the hosted runner Codex catalog for the prepared future slugs with flex service tier support.
5. Add/update focused tests and durable docs.
6. Run required verification, commit, push, open PR, then run ReviewGPT PR loop to zero accepted findings.

## Verification

- PASS `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-control.test.ts`
- PASS `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-execution-usage-allowance.test.ts`
- PASS `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/deploy-preflight.test.ts apps/cloudflare/test/container-image-contract.test.ts`
- PASS `pnpm typecheck`
- PASS `pnpm --dir packages/hosted-local-harness test`
- PASS `pnpm test:diff Dockerfile.cloudflare-hosted-runner packages/hosted-execution/src/runtime-control.ts packages/hosted-execution/test/hosted-runtime-control.test.ts apps/web/src/lib/hosted-execution/usage-allowance.ts apps/web/test/hosted-execution-usage-allowance.test.ts apps/cloudflare/scripts/deploy-preflight.ts apps/cloudflare/test/deploy-preflight.test.ts apps/cloudflare/test/container-image-contract.test.ts apps/cloudflare/DEPLOY.md agent-docs/operations/verification-and-runtime.md`
- PENDING ReviewGPT PR loop and final PR CI.

## Open Questions

- Public provider availability and exact launch pricing for `gpt-5.6-terra`, `gpt-terra`, `gpt-sol`, and `gpt-5.6-luma` are UNCONFIRMED until OpenAI publishes or enables them.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
