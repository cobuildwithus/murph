# PR 328 ReviewGPT Round 3

## Goal

Resolve the accepted ReviewGPT round-3 invariant-violation finding: the PR moved provider *request* shapes to canonical SDK types but left *response* shapes as bespoke hand-shaped interfaces or untyped boundaries, which violates the round-2 invariant in `docs/contracts/00-invariants.md` § Deliverability And Provider Capability Contract (request **and** response shapes should come from the provider's canonical SDK or be documented as a custom boundary with focused tests).

Success criteria:

- Linq response shapes consumed by hosted-web and operator-config come from `@linqapp/sdk` exports (`ChatCreateResponse`, `MessageSendResponse`, `PhoneNumberListResponse`, `WebhookSubscriptionCreateResponse`).
- Bespoke `LinqCreateChatResponse` / `LinqCreateWebhookSubscriptionResponse` / `LinqSendMessageResponse` / `LinqListPhoneNumbersResponse` interfaces are deleted from `packages/messaging-ingress/src/linq-webhook.ts`.
- OpenAI response boundaries (image generation, first-contact admission) carry an explicit custom-boundary comment naming the canonical SDK shape and the test that covers it, since they intentionally keep raw fetch + defensive `unknown` parsing (auth/timeout/retry stay on murph owners).
- Existing CLI release validation still passes (SDK pins stay in `devDependencies`, no SDK runtime imports in emitted JS).
- Focused typechecks and tests rerun for the touched owners.
- Commit, push, and fire ReviewGPT round 4.

## Constraints/Assumptions

- Keep all runtime transport, credential, and retry boundaries unchanged.
- Keep defensive runtime parsing where it already exists; type-tightening alone, no behavior change.
- Do not add the OpenAI or Linq SDKs to runtime `dependencies`; type-only imports continue to satisfy the request and response contracts.
- Keep ReviewGPT artifacts under `audit-packages/` local and uncommitted.

## Work Plan

1. Replace the four bespoke Linq response interfaces in `packages/messaging-ingress/src/linq-webhook.ts` with re-imports of the SDK response types at the consumer call sites (`packages/operator-config/src/linq-runtime.ts`, `apps/web/src/lib/hosted-onboarding/linq-client.ts`). Delete the now-unused bespoke interfaces.
2. Add a short custom-boundary comment at each OpenAI response parse function (`parseOpenAiImageGenerationPayload`, `readHostedLinqFirstContactAdmissionTerminalBlock`) naming the canonical SDK shape (`ImagesResponse`, `Response` from `openai/resources/responses/responses`) and the focused test file.
3. Rerun focused typechecks, tests, build, dist scan, release-target, and dependency gates.
4. Commit, push, and fire ReviewGPT round 4 on the pushed PR head.

## Verification

- PASS `pnpm --filter @murphai/operator-config typecheck`
- PASS `pnpm --filter @murphai/messaging-ingress typecheck`
- PASS `pnpm --filter @murphai/assistant-engine typecheck`
- PASS `pnpm --filter @murphai/hosted-web typecheck:prepared`
- PASS `pnpm --filter @murphai/operator-config build`
- PASS `pnpm --filter @murphai/messaging-ingress build`
- PASS `pnpm --filter @murphai/assistant-engine build`
- PASS emitted JS scan: no `openai` or `@linqapp/sdk` runtime imports in `packages/assistant-engine/dist`, `packages/operator-config/dist`, or `packages/messaging-ingress/dist`
- PASS `node scripts/verify-release-target.mjs --json`
- PASS `pnpm --filter @murphai/operator-config exec vitest run --config vitest.config.ts --no-coverage test/http-linq-device-runtime.test.ts test/runtime-helpers.test.ts test/http-linq-device-runtime-branches.test.ts`
- PASS `pnpm --filter @murphai/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-generate-image-tool.test.ts`
- PASS `pnpm --filter @murphai/hosted-web prisma:generate && pnpm --filter @murphai/hosted-web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-onboarding-linq-first-contact-admission.test.ts test/hosted-onboarding-linq-http.test.ts`
- PASS `pnpm deps:guard`
- PASS `pnpm deps:ignored-builds`

Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
