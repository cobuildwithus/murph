# Required Worker Crypto Vars

## Goal

Land the final hosted crypto deploy cleanup so worker public crypto bindings are modeled as required worker vars and reused by deploy automation, preflight, and hosted-local Wrangler allowlisting.

Success criteria:

- Required hosted crypto worker vars live in one exported list.
- Deploy automation requires those vars.
- Deploy preflight uses the shared list and rejects non-canonical `HOSTED_CRYPTO_ENV` values.
- Hosted-local help documents the remote-key escape hatch.
- Focused tests, typecheck, and `pnpm dev` proof pass.

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

## Now

- Run required completion reviews and close out scoped verification.

## Next

- Commit the scoped deploy cleanup plus bridge compile repair if review passes.

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
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
