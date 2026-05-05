# Switch hosted assistant model provider to OpenAI

Status: handoff
Created: 2026-05-05
Updated: 2026-05-05

## Goal

- Switch hosted Codex model-provider configuration from Vercel AI Gateway to direct OpenAI while preserving the existing Codex App Server runtime boundary, hosted secret isolation, and mocked/local verification paths.

## Success criteria

- Hosted runner env policy requires `HOSTED_ASSISTANT_PROVIDER=openai` with `OPENAI_API_KEY` instead of `vercel-ai-gateway` with `VERCEL_AI_API_KEY`.
- Hosted Codex config writes an OpenAI model provider entry that points at the official OpenAI API base URL and uses `OPENAI_API_KEY`.
- Local hosted-dev, deploy automation, smoke fixtures, docs, and focused tests no longer advertise Vercel AI Gateway as the required model provider.
- Existing usage/billing semantics either stay valid for Murph-owned metering or are updated where they explicitly describe delegated Vercel AI Gateway metering.

## Scope

- In scope:
  - `packages/operator-config` hosted assistant provider constants and normalization.
  - `packages/assistant-runtime` hosted Codex config generation and launch checks.
  - `apps/cloudflare` hosted runner env policy, deploy docs, smoke/test fixtures, and deploy secret allowlists.
  - `scripts/dev-hosted-local` hosted-local provider/key validation and docs/tests.
- Out of scope:
  - Replacing Codex App Server itself.
  - Live provider calls or production secret rotation.
  - Broad assistant provider refactors unrelated to the hosted provider cutover.

## Constraints

- Technical constraints:
  - Do not expose raw provider keys or `.env` contents.
  - Preserve the existing isolated child environment and Codex shell env allowlist behavior.
  - Preserve unrelated dirty work in overlapping hosted runtime files.
- Product/process constraints:
  - This is high-risk trust-boundary work; run security/privacy review and completion review before handoff.
  - Commit through `scripts/finish-task` if scoped staging is safe.

## Risks and mitigations

1. Risk: Leaving a stale Vercel-only env requirement can make hosted runner launches fail after secret rotation.
   Mitigation: Update both runtime validation and focused tests for provider/key requirements.
2. Risk: Direct OpenAI config could accidentally forward `OPENAI_API_KEY` to Codex shell tools.
   Mitigation: Keep provider key out of `shell_environment_policy.include_only` and preserve smoke/test assertions.
3. Risk: Usage billing docs/tests may still claim upstream Vercel delegated metering.
   Mitigation: Review explicit billing references and only retain Vercel text where it is historical or intentionally unsupported.

## Tasks

1. Locate the hosted provider constants, env policy, and Codex config generation.
2. Patch the smallest owning runtime/config surfaces from Vercel AI Gateway to OpenAI.
3. Update local hosted-dev/deploy docs and tests that assert the provider/key contract.
4. Run focused tests/typecheck for touched owners.
5. Run required security/privacy, coverage, and task-finish audit passes, then close/commit if safe.

## Decisions

- Keep `HOSTED_ASSISTANT_PROVIDER` as the provider selector and set its required hosted value to `openai`; do not introduce a second selector or compatibility alias unless tests show legacy fallback is required.
- Keep generic Vercel AI Gateway provider metadata available outside the hosted runner path, but make hosted runner validation, local dev, deploy config, and smoke fixtures require direct OpenAI.
- Keep Codex shell credential isolation: `OPENAI_API_KEY` is present for the Codex process/provider config, not added to the shell `include_only` allowlist.
- Treat `OPENAI_API_KEY` as platform-owned hosted runner env, not member-supplied runner secret material. Users cannot override it through runner secrets, even with a custom allowlist.
- Require `HOSTED_ASSISTANT_PROVIDER=openai` at Cloudflare runner env and deploy-preflight boundaries, not only at Codex config generation time.

## Verification

- Passed:
  - `pnpm --filter @murphai/operator-config build`
  - `OPENAI_API_KEY=local-openai-key pnpm typecheck`
  - `OPENAI_API_KEY=local-openai-key pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts packages/assistant-runtime/test/hosted-runtime-environment.test.ts packages/assistant-runtime/test/hosted-runtime-platform.test.ts packages/operator-config/test/hosted-assistant-bootstrap.test.ts packages/operator-config/test/config-env.test.ts --no-coverage`
  - `OPENAI_API_KEY=local-openai-key pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-env-policy.test.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/node-runner-hosted-assistant.test.ts apps/cloudflare/test/deploy-preflight.test.ts apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/env.test.ts apps/cloudflare/test/runner-secrets.test.ts apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/hosted-runner-static-secret-invariant.test.ts --no-coverage`
  - `OPENAI_API_KEY=local-openai-key pnpm exec vitest run --config vitest.config.ts test/assistant-cli-access.test.ts test/provider-registry-helpers.test.ts --no-coverage` from `packages/assistant-engine`
  - `OPENAI_API_KEY=local-openai-key pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/config.test.ts scripts/dev-hosted-local/stack.test.ts scripts/dev-hosted-local/environment.test.ts scripts/dev-hosted-local/runtime.test.ts --no-coverage`
  - `git diff --check`
  - diff privacy scan
  - GitHub production environment check: `HOSTED_ASSISTANT_PROVIDER=openai`, `HOSTED_ASSISTANT_MODEL=gpt-5.5`, `OPENAI_API_KEY` secret exists
- Required reviews:
  - Task-finish review found stale `node-runner-child` and invalid-output fallback tests; both were updated and rerun.
  - Security/privacy review found three credential-boundary gaps; fixes added `OPENAI_API_KEY` to hosted Codex process env projection, blocked user runner-secret overrides for model credentials, and enforced provider selection at runner/deploy boundaries.
- Commit status:
  - Scoped commit blocked by unrelated dirty/overlapping worktree edits in hosted runner and other app/content files.
