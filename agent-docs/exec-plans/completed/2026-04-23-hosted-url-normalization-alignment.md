# Align hosted URL normalization and reject pathful hosted public bases

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Keep the shared hosted URL-normalization seam aligned across `packages/hosted-execution`, `apps/web`, and `apps/cloudflare`, while making hosted public/web-control base URLs fail closed when configured with non-root paths.

## Why

- Hosted public/web-control callers disagreed on whether a configured base path like `https://example.test/app` was part of the contract.
- Some web builders preserved the path, while Cloudflare callbacks and origin-derived fallbacks stripped to root, so the same config could silently split traffic between `/app/...` and `/...`.
- The shared normalization seam already carried related explicit-URL and IPv6 loopback work, so the safest fix was to extend that seam rather than add more app-local path handling.

## Scope

- `packages/hosted-execution/src/env.ts`
- `apps/web/src/lib/hosted-web/public-url.ts`
- `apps/web/next.config.ts`
- `apps/cloudflare/src/{web-control-plane.ts,hosted-execution-worker-env.ts}`
- directly coupled tests in:
- `packages/hosted-execution/test/origin-base-url.test.ts`
- `apps/web/test/{public-url.test.ts,hosted-onboarding-landing.test.ts,next-config.test.ts}`
- `apps/cloudflare/test/{hosted-web-base-url-contract.test.ts,runner-outbound.test.ts,runner-platform.test.ts}`
- directly coupled docs:
- `apps/web/README.md`
- `apps/cloudflare/README.md`

## Out of scope

- Adding real subpath deployment support for hosted public/web-control URLs
- Broad hosted auth, onboarding, billing, or Cloudflare runner refactors outside the URL contract
- Tightening intentionally pathful route-base clients such as `DEVICE_SYNC_PUBLIC_BASE_URL` or other explicit route-mounted control clients

## Constraints

- Keep the diff additive in a dirty tree with active unrelated hosted work.
- Reuse the shared hosted-execution normalization seam rather than creating another ad hoc URL validator.
- Preserve intentional pathful contracts while rejecting only the hosted public/web-control sources that should be origin-only.

## Tasks

1. Completed: register the hosted URL-contract lane and inspect the current normalization/test coverage.
2. Completed: add an opt-in shared `requireOriginOnly` normalization mode so origin-only callers fail closed on non-root paths without breaking pathful route clients.
3. Completed: apply the stricter origin-only validation to `apps/web` hosted public-base readers, the Vercel public-base fallback, and Cloudflare hosted web-control/env readers.
4. Completed: add focused regression coverage for the new path-rejection branches plus the remaining hosted public-base precedence sources.
5. Completed: run focused verification, required audit passes, and a scoped commit for the code/docs/test slice.

## Verification

- `pnpm typecheck`
  Result: failed for unrelated pre-existing issues in `packages/contracts/scripts/verify.ts` and `packages/core/src/operations/write-batch.ts`.
- `bash scripts/workspace-verify.sh test:diff packages/hosted-execution/src/env.ts apps/web/src/lib/hosted-web/public-url.ts apps/web/next.config.ts apps/cloudflare/src/web-control-plane.ts apps/cloudflare/src/hosted-execution-worker-env.ts ...`
  Result: failed for unrelated workspace-boundary/core type issues outside this seam.
- Focused proof passed:
- `pnpm --dir packages/hosted-execution test -- test/hosted-execution.test.ts test/origin-base-url.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/public-url.test.ts apps/web/test/hosted-onboarding-landing.test.ts apps/web/test/next-config.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/hosted-web-base-url-contract.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/runner-platform.test.ts --no-coverage`
- `pnpm test:smoke`
- `git diff --check -- <touched files>`
- Direct scenario proof:
- `resolveHostedPublicBaseUrl({ HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.test/app" })` returns `null`
- `normalizeHostedWebControlBaseUrl("https://web.example.test/app")` throws `Hosted execution origin base URLs must not include a path; configure only the origin.`

## Audits

- Required `coverage-write` pass completed with no extra test changes needed.
- Required `task-finish-review` pass completed with one low finding; fixed by adding explicit fail-closed coverage for pathful `HOSTED_WEB_BASE_URL` and pathful `VERCEL_PROJECT_PRODUCTION_URL`.

## Outcome

- Hosted public/web-control base URLs now fail closed when configured with a non-root path, preventing split behavior between `/app/...` and `/...`.
- `DEVICE_SYNC_PUBLIC_BASE_URL` remains path-capable, preserving the explicit `/api/device-sync` callback-base contract.
- Operator docs now state that `HOSTED_ONBOARDING_PUBLIC_BASE_URL`, `HOSTED_WEB_BASE_URL`, and the Vercel fallback must be origin-only.

## Commit note

- Scoped code/docs/test commit landed as `acf46897f8c2` via `scripts/committer`.
- `scripts/finish-task` was intentionally not used because the shared `COORDINATION_LEDGER.md` already had broad unrelated dirty-tree churn that would have been absorbed by a plan-closing commit.

## Notes

- The shared `COORDINATION_LEDGER.md`, `packages/hosted-execution/test/hosted-execution.test.ts`, and `apps/cloudflare/test/env.test.ts` still carry unrelated in-progress dirty-tree edits outside this committed slice.
Completed: 2026-04-24
