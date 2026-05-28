# Hosted Local Workspace Callback Auth

Goal (incl. success criteria):
- Fix `pnpm dev` local hosted signup so the Cloudflare runner can call the web-owned hosted workspace routes without tripping `HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED`.
- Keep production callback auth fail-closed and do not introduce secret-bearing URL paths or weaker local-only auth.
- Add focused regression coverage for the exact local hosted callback/auth mismatch.

Constraints/Assumptions:
- Preserve unrelated dirty work and active ledger rows.
- Treat this as high-risk hosted auth/runtime work.
- Do not print, fixture, or persist secrets, raw identifiers, raw request bodies, or local machine paths.
- Prefer the existing hosted-execution signing and local proxy contracts over a second auth scheme.

Key decisions:
- UNCONFIRMED until inspection: root cause likely sits at the request URL/origin/host reconstruction boundary between the local Cloudflare proxy and `apps/web` callback auth.

State:
- verifying

Done:
- Read required repo workflow, architecture, product, security, verification, and testing docs.
- Traced workspace callback auth through the web route, Cloudflare direct web-control signer, local internal proxy, and hosted-local environment assembly.
- Patched hosted-local callback public keyring assembly so the current key id is always derived from the current local private signing key before web and Cloudflare start.
- Added focused stale-keyring regression coverage for `mergeCloudflareLocalEnv` and `buildHostedLocalDevOverrides`.
- Completed coverage and security/privacy audit passes with no code findings.
- Reproduced the newer `pnpm dev` failure: after web/Cloudflare health checks, Linq webhook registration returned HTTP 500 and aborted startup.
- Rejected warn-and-continue behavior because local Linq webhook delivery should work when the tunnel is configured.
- Patched startup to wait for the public Linq webhook target to return HTTP 200 before calling Linq subscription registration; Linq registration failures still fail startup.
- Cleared stale interrupted local dev/typecheck processes before rerunning `pnpm dev`.

Now:
- `pnpm dev` is blocked before Linq startup by unrelated `packages/query` TypeScript build errors.

Next:
- Decide whether to take on the unrelated query build blocker, then rerun live `pnpm dev` to verify Linq tunnel registration with the readiness gate.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the user's local failure came from a stale persisted keyring/private-key mismatch or another unsigned caller; the fix removes the stale-keyring mismatch class and keeps callback auth fail-closed.

Working set (files/ids/commands):
- `scripts/dev-hosted-local/**`

Verification:
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/environment.test.ts --no-coverage` passed.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/linq-webhook-tunnel.test.ts scripts/dev-hosted-local/stack.test.ts --no-coverage` passed.
- `bash scripts/workspace-verify.sh test:diff scripts/dev-hosted-local/environment.ts scripts/dev-hosted-local/environment.test.ts` failed on unrelated `scripts/research-init.test.ts` zip-entry expectation; the focused hosted-local environment test passed.
- `pnpm typecheck` passed.
- `git diff --check -- scripts/dev-hosted-local/environment.ts scripts/dev-hosted-local/environment.test.ts agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-05-02-hosted-local-workspace-callback-auth.md` passed.
- `pnpm dev` failed before Linq tunnel verification because `packages/query` build currently fails with browser-replica metric type errors.
