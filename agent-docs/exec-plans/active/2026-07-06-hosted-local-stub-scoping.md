# Hosted Local Stub Scoping

## Goal

Make hosted-local assistant-provider scripted responses immune to cross-turn theft by scoping queued responses to the requesting member when feasible.

## Constraints

- Harness-only; no production code changes.
- Verify member identity is extractable from `/v1/responses` request bodies before choosing the member-key approach.
- If member identity is unavailable, use a content-matcher fallback instead; implement only one approach.
- Keep enqueue call-site churn minimal and update affected hosted-local suites consistently.
- Preserve fallback behavior for unscripted turns and the existing 500 behavior for requests that require queued scripts.
- Do not run hosted E2E locally.
- Do not commit.

## Plan

1. Inspect the assistant-provider stub, recorded request body shape, enqueue sites, and Linq restart helper.
2. Verify whether a stable member key can be derived from request bodies.
3. Implement the chosen scoped queue behavior in the test helper.
4. Update focused helper tests and hosted-local enqueue call sites.
5. Run `pnpm typecheck` and focused helper/harness tests, then review the diff for privacy and scope.

## Verification

- `pnpm typecheck`
- Focused hosted-local assistant stub/helper tests
- Fast harness tests touching the helper as needed

## State

Implemented 2026-07-06 and left uncommitted for supervisor review.

- Member-key scoping was not feasible from provider request bodies; no stable hosted member/user key is present in the JSON sent to `/v1/responses`.
- Chosen approach: content matcher scoping with `matchInputContains` on queued assistant-provider responses.
- Updated hosted-local enqueue sites to pass trigger text or another stable prompt-visible trigger such as attachment file name or saved automation title.
- Verified `restartLinqScenario` stops the old scenario/stub and starts a fresh `HostedLocalAssistantProviderStubState`.
- `pnpm typecheck` passed after restoring ignored build artifacts needed by the workspace gate.
- Focused helper tests passed with `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/hosted-local-e2e-support.test.ts apps/cloudflare/test/helpers/hosted-local-dev-harness.test.ts apps/cloudflare/test/helpers/hosted-local-linq-support.test.ts apps/cloudflare/test/helpers/hosted-local-wake.test.ts`.
- Hosted E2E was not run locally per task constraint.
