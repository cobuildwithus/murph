# Linq And OpenAI SDK Pins

## Goal

Use canonical Linq and OpenAI SDK packages as typed request-shape authorities while preserving the current hosted runtime credential and egress boundaries.

Success criteria:

- `openai` is added with an exact version pin where OpenAI request payloads are constructed.
- `@linqapp/sdk` is added with an exact version pin where Linq partner API request payloads are constructed.
- OpenAI Responses, OpenAI image generation, and Linq request bodies are typed from the SDK packages where practical.
- The Cloudflare egress intercept remains the credential-injection and outbound-authority boundary.
- `docs/contracts/00-invariants.md` records the canonical lightweight pinned SDK preference for future provider surfaces.
- Focused tests, typecheck, and dependency guard/audit checks are run or any pre-existing blocker is reported.

## Constraints/Assumptions

- Do not move provider credentials out of their existing owners.
- Preserve provider URL, method, body, idempotency, timeout, and retry behavior unless an SDK type proves a mismatch.
- Exact dependency pins only; no ranges for the new direct dependencies.
- Avoid broad runtime rewrites; this is a request-shape hardening change.

## Work Plan

1. Add exact SDK pins and update the lockfile through pnpm.
2. Inspect SDK exported types and map them to existing request builders.
3. Apply SDK request parameter types to OpenAI and Linq payload construction.
4. Add the durable provider SDK invariant.
5. Run focused tests, typecheck, dependency checks, and final diff review.
6. Commit the scoped branch and open a draft PR.

## Verification

- PASS: `pnpm install --lockfile-only --frozen-lockfile`
- PASS: `pnpm install --frozen-lockfile`
- PASS: `pnpm --filter @murphai/operator-config build`
- PASS: `pnpm --filter @murphai/operator-config typecheck`
- PASS: `pnpm --filter @murphai/assistant-engine typecheck`
- PASS: `pnpm --filter @murphai/hosted-web typecheck:prepared`
- PASS: `pnpm --filter @murphai/operator-config exec vitest run --config vitest.config.ts --no-coverage test/http-linq-device-runtime.test.ts test/runtime-helpers.test.ts`
- PASS: `pnpm --filter @murphai/operator-config exec vitest run --config vitest.config.ts --no-coverage test/http-linq-device-runtime-branches.test.ts`
- PASS: `pnpm --filter @murphai/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-generate-image-tool.test.ts`
- PASS: `pnpm --filter @murphai/hosted-web prisma:generate && pnpm --filter @murphai/hosted-web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-onboarding-linq-first-contact-admission.test.ts test/hosted-onboarding-linq-http.test.ts`
- PASS: `pnpm deps:guard`
- PASS: `pnpm deps:ignored-builds`
- FAIL (pre-existing transitive advisories outside the new SDK packages): `pnpm deps:audit`
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
