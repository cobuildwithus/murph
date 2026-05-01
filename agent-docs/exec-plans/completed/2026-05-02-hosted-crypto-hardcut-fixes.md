# Land supplied hosted crypto hard-cut fixes

Status: completed
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Land the supplied hosted crypto hard-cut fixes that move hosted mailbox and hosted web private fields off the legacy global hosted encryption env keys, tighten worker runtime crypto-context authority checks, and keep device-sync token refactoring out of this slice.

## Success criteria

- Supplied patch script applies cleanly or is ported faithfully to current repo state.
- Hosted mailbox payload encryption uses the secure-box ingress/mailbox-payload path and a separate HMAC-only mailbox fingerprint key.
- Hosted web private-field encryption uses the secure-box hosted-member-private-field path.
- Cloudflare mailbox payload decrypts through the unwrapped ingress root, and production runtime crypto-context validation requires an authority signing key version.
- The internal runtime crypto-context callback denies inactive members and unprovisioned workspaces.
- Prisma generate, typecheck, truthful scoped tests, required audit passes, and diff checks are run or blockers are documented.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-mailbox/{encryption,store,fingerprint}.ts`
  - `apps/web/src/lib/hosted-web/encryption.ts`
  - `apps/web/app/api/internal/hosted-runtime/crypto-context/route.ts`
  - `apps/cloudflare/src/hosted-mailbox-encryption.ts`
  - `apps/cloudflare/src/hosted-crypto/runtime-crypto-context.ts`
  - `apps/web/.env.example`
  - Directly coupled tests only if needed.
- Out of scope:
  - Device-sync token secure-box async refactor.
  - Provider-account blind-index key changes.
  - Broader hosted runtime/workspace route refactors.

## Constraints

- Technical constraints:
  - Preserve active hosted mailbox/runtime rows that already mention adjacent files.
  - Do not reintroduce `HOSTED_WAKE_ENCRYPTION_KEY` or `HOSTED_WEB_ENCRYPTION_KEY` as data-encryption keys.
  - Do not weaken hosted active-member/workspace authorization to make tests pass.
- Product/process constraints:
  - Treat this as a high-risk trust-boundary/security change.
  - Keep scoped to the supplied patch intent unless current repo state requires a narrow port.
  - Preserve unrelated dirty work.

## Risks and mitigations

1. Risk: the apply script assumes one-line formatted current files and may not match local drift.
   Mitigation: inspect failures, port only the intended hunks, and verify with focused tests/typecheck.
2. Risk: async secure-box conversion can leave sync call sites stale.
   Mitigation: use TypeScript and focused mailbox/web tests to find call-site gaps.
3. Risk: env/example edits can accidentally remove unrelated configured keys.
   Mitigation: inspect the `.env.example` diff and only strip legacy global data-key entries.

## Tasks

1. Register plan and ledger scope.
2. Apply the supplied patch script and run it from repo root.
3. Fix compile/test fallout while staying inside scope.
4. Run required verification and direct grep/readback proof.
5. Run required security/privacy, coverage, and final audit passes.
6. Close the plan and create a scoped commit when safe.

## Decisions

- Device-sync token secure-box migration remains a follow-up task, matching the supplied patch caveat.
- The supplied apply script was used as an input artifact but was not kept in the repo because it partially failed against current source shape; the resulting source/test changes were ported directly.
- `apps/web/.env.example` keeps `DEVICE_SYNC_ENCRYPTION_KEY*` placeholders because device-sync remains on its existing synchronous keyring until the follow-up async secure-box refactor.
- A scoped commit is not safe from this shared checkout because this task overlaps another active hosted crypto cleanup row in `apps/cloudflare/src/runtime-bridge-workspace.ts` and related Cloudflare env tests; closing the plan without committing preserves lane separation.

## Verification

- Passed:
  - `pnpm --dir apps/web prisma:generate`
  - `pnpm --dir apps/web exec tsc --noEmit --pretty false`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm typecheck`
  - `pnpm exec vitest run apps/web/test/crypto.test.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-billing-service.test.ts apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-member-identity-service.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-privy-invite-status.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/hosted-onboarding-routes.test.ts apps/web/test/dev-smoke.test.ts apps/web/test/env.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `pnpm exec vitest run apps/web/test/hosted-runtime-crypto-context-route.test.ts apps/web/test/hosted-mailbox-store.test.ts apps/web/test/crypto.test.ts apps/web/test/dev-smoke.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `pnpm exec vitest run apps/cloudflare/test/runtime-bridge-workspace.test.ts apps/cloudflare/test/hosted-runtime-crypto-context.test.ts apps/cloudflare/test/hosted-runtime-crypto-context-route.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/runner-env.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage`
  - `pnpm exec vitest run apps/cloudflare/test/hosted-mailbox-encryption.test.ts apps/cloudflare/test/hosted-runtime-crypto-context.test.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts apps/cloudflare/test/runner-env.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage`
  - `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-environment.test.ts packages/assistant-runtime/test/package-entrypoints.test.ts --no-coverage`
  - `git diff --check -- <task-owned paths>`
- Failed / unrelated:
  - `pnpm test:diff` failed in repo-tool tests on unrelated active workspace state: generated Workflow `.js` artifacts under `apps/web/app/.well-known/workflow/...` and Health Commons packaging expectations for protocol content.
Completed: 2026-05-02
