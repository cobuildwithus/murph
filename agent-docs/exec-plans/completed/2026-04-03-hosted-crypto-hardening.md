# 2026-04-03 Hosted Crypto Hardening

## Goal (incl. success criteria)

- Land the supplied `hosted-crypto-hardening.patch` on top of the current `murph` snapshot.
- Preserve unrelated dirty-tree work while porting the intended hosted hardening changes across Cloudflare, web, and shared packages.
- Verify the landing with the repo-required checks plus focused proof for the new token-set and encryption-keyring behavior.

## Constraints / Assumptions

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Preserve unrelated in-flight work already present in the worktree.
- This is a high-risk change touching auth tokens, storage crypto, object naming, retention, and hosted onboarding/device-sync secret handling.

## Key Decisions

- Use the supplied patch as the primary source of intent, but rebase it manually where the current snapshot has drifted.
- Keep the scope limited to the immediate hardening set described in the supplied summary; do not add the deferred per-user DEK / chunked manifest architecture.

## State

- Done.

## Done

- Confirmed the user provided patch does not target the current `review-gpt` repo and identified `murph` as the matching sibling checkout.
- Read the required Murph workflow, security, reliability, and verification docs.
- Confirmed the supplied patch mostly matches the `murph` snapshot and identified drifted files that need manual rebasing.
- Registered the work in the coordination ledger and opened this execution plan.
- Landed the supplied hardening changes across Cloudflare, hosted web, and shared hosted-execution/runtime-state packages, including domain-separated storage crypto, AAD binding, opaque object keys, token-set auth, shorter transient retention, web-side keyrings, separate onboarding/contact-privacy roots, and exact per-user env allowlisting.
- Rebasing the drifted hosted-email route layer onto the current snapshot also extended the same route-record hardening to the newer verified-sender index records.
- Updated focused hosted tests to match the new token-list and exact-key behavior, plus the new opaque-key/AAD storage semantics.
- Verified the landed slice with:
  - `PATH="/tmp/codex-pnpm-bin:$PATH" pnpm --dir packages/hosted-execution typecheck`
  - `PATH="/tmp/codex-pnpm-bin:$PATH" pnpm --dir packages/runtime-state typecheck`
  - `PATH="/tmp/codex-pnpm-bin:$PATH" pnpm --dir packages/hosted-execution test`
  - `PATH="/tmp/codex-pnpm-bin:$PATH" pnpm --dir packages/runtime-state test`
  - `PATH="/tmp/codex-pnpm-bin:$PATH" pnpm --dir apps/web lint`
  - `PATH="/tmp/codex-pnpm-bin:$PATH" pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/env.test.ts apps/cloudflare/test/user-env.test.ts apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/smoke-hosted-deploy.test.ts apps/cloudflare/test/runner-container.test.ts --no-coverage`
  - `PATH="/tmp/codex-pnpm-bin:$PATH" pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/outbox-delivery-journal.test.ts apps/cloudflare/test/runner-bundle-helpers.test.ts apps/cloudflare/test/env.test.ts apps/cloudflare/test/user-env.test.ts --no-coverage`
  - `PATH="/tmp/codex-pnpm-bin:$PATH" pnpm --dir . exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/env.test.ts apps/web/test/hosted-onboarding-env.test.ts apps/web/test/auth.test.ts apps/web/test/hosted-execution-routes.test.ts apps/web/test/hosted-device-sync-internal-routes.test.ts apps/web/test/hosted-share-internal-route.test.ts apps/web/test/device-sync-hosted-wake-dispatch.test.ts --no-coverage`
- Captured direct scenario proof with a `tsx --eval` script showing:
  - outbound token selection uses the first configured token while preserving the full accepted token sets
  - device-sync keyring loading exposes both `legacy` and current key versions
  - hosted onboarding keyring loading exposes both `legacy` and current key versions
  - hosted onboarding now uses a separate contact-privacy root key
- Confirmed repo-wide commands remain blocked by unrelated in-flight work outside this patch:
  - `PATH="/tmp/codex-pnpm-bin:$PATH" pnpm typecheck` fails in `packages/device-syncd/**` and `packages/query/**`
  - `PATH="/tmp/codex-pnpm-bin:$PATH" pnpm test` and `PATH="/tmp/codex-pnpm-bin:$PATH" pnpm test:coverage` fail for the same unrelated `packages/query/**` / `packages/device-syncd/**` drift, plus `apps/web/test/agent-session-service.test.ts` compiling against that separate device-sync provider change

## Now

- Close the plan and create the scoped commit for the landed hosted-hardening slice.

## Next

- Hand off the landed patch with the focused verification results and the blocked repo-wide commands called out as unrelated existing worktree drift.

## Open Questions

- None.

## Working Set (files / ids / commands)

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-03-hosted-crypto-hardening.md`
- `/Users/willhay/Downloads/hosted-crypto-hardening.patch`
- `/Users/willhay/Downloads/hosted-crypto-hardening-summary.md`
- `apps/cloudflare/**`
- `apps/web/**`
- `packages/hosted-execution/**`
- `packages/runtime-state/**`
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
