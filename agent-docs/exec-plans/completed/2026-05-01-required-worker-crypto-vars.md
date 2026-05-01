# Required Worker Crypto Vars

## Goal

Land the final hosted crypto deploy cleanup so worker public crypto bindings are modeled as required worker vars and reused by deploy automation, preflight, and hosted-local Wrangler allowlisting.

Success criteria:

- Required hosted crypto worker vars live in one exported list.
- Deploy automation requires those vars.
- Deploy preflight uses the shared list and rejects non-canonical `HOSTED_CRYPTO_ENV` values.
- Hosted-local help documents the remote-key escape hatch.
- Focused tests, typecheck, and `pnpm dev` proof pass; full hosted-local E2E is attempted and any remaining non-crypto runner failure is captured.

## Constraints / Assumptions

- Preserve unrelated Health Commons/UI dirty edits.
- Do not print `.env`, `.dev.vars`, private keys, or raw credentials.

## Key Decisions

- Keep required public worker vars separate from required secrets.

## State

implemented_verified

## Done

- Cleaned stale hosted-local runtime residue from the previous interrupted proof.
- Landed the required hosted crypto worker var cleanup across deploy automation, preflight, hosted-local allowlisting, and focused tests.
- Cleared corrupt disposable Next dev cache artifacts that caused `localhost:3000` JSON parse 500s.
- Adapted `apps/cloudflare/src/runtime-bridge-workspace.ts` to the current hosted mailbox encryption hard-cut API so the clean hosted-local runner bundle builds.
- Verified `pnpm dev` reaches hosted-local ready and serves web/worker endpoints.
- Added Prisma schema coverage for hosted crypto envelope/audit tables so push-based local E2E databases match migrations.
- Threaded hosted-local generated runtime env into direct E2E seed helpers and provisioned hosted crypto roots during activation/test seeding.
- Re-ran hosted-local E2E; the original missing table/env/root failures are cleared, but the mailbox scenario still times out on a runner child invocation 500.

## Now

- Run scoped verification and close out with the remaining hosted-local runner child E2E failure noted.

## Next

- Commit the scoped deploy cleanup plus local harness fixes if verification is clean aside from known unrelated/runner-child failures.

## Open Questions

- None.

## Working Set

- `apps/cloudflare/scripts/deploy-automation.ts`
- `apps/cloudflare/scripts/deploy-automation/environment.ts`
- `apps/cloudflare/scripts/deploy-automation/worker-optional-vars.ts`
- `apps/cloudflare/scripts/deploy-preflight.ts`
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `apps/cloudflare/test/deploy-preflight.test.ts`
- `scripts/dev-hosted-local/config.ts`
- `scripts/dev-hosted-local/constants.ts`
- `apps/web/prisma/schema.prisma`
- `apps/web/src/lib/hosted-crypto/domain-root-store.ts`
- `apps/web/src/lib/hosted-onboarding/member-activation.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-member-test-seed.ts`
- `apps/web/test/hosted-onboarding-member-activation.test.ts`
- `apps/cloudflare/test/helpers/hosted-local-dev-harness.ts`
- `apps/cloudflare/test/helpers/hosted-local-full-stack-scenario.ts`
- `scripts/dev-hosted-local/stack.ts`
- `scripts/check-no-js.ts`
- `scripts/repo-tools.config.sh`
- `scripts/review-gpt.config.sh`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
