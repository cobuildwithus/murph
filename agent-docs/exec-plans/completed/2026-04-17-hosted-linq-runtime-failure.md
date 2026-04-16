## Goal

Eliminate the hosted-local Linq and Telegram rapid-turn/runtime continuity failure end to end so the Cloudflare-hosted path preserves one assistant session across rapid inbound turns and across cold/warm container boundaries.

## Scope

- `apps/cloudflare/src/**`
- `apps/cloudflare/test/hosted-local-*.test.ts`
- `apps/cloudflare/test/runner-*.test.ts`
- `scripts/dev-hosted-local/**`
- directly supporting hosted runtime or bundle-policy files proven necessary by the root cause

## Constraints

- Fix the underlying hosted-state/runtime failure, not just duplicate-message symptoms.
- Preserve local-first behavior outside the hosted execution path.
- Prefer a simple hosted architecture that matches local behavior as closely as possible.
- Keep secrets, token-bearing paths, and personal identifiers out of logs, tests, docs, and commits.

## Key Findings

- The failing rapid-turn path was not just prompt construction. The second hosted inbound event could boot from stale or incomplete runner state.
- Hosted-local snapshots intentionally excluded some runtime continuity files, which let local and hosted diverge and increased restore complexity.
- The hosted local runner also needed a reliable bridge from the container back to the worker/provider stubs; plain container-local `127.0.0.1` assumptions were invalid.
- A first follow-up fix exposed security gaps: the local internal proxy route needed stricter ingress checks, user binding, and token redaction.
- A DO lookup approach for proxy-token ownership was incorrect because the runner DO cannot safely service that extra ownership check during an active `invoke`.

## Decisions

- Bundle the full hosted runtime continuity material needed for restores rather than relying on hosted-only reconstruction when avoidable.
- Route hosted-local container traffic through a dedicated local internal proxy path instead of generic localhost tunneling.
- Use a stateless HMAC-signed per-run proxy token bound to the user id rather than a DO ownership lookup.
- Keep the child process unaware of the long-lived loopback secret by passing it a pre-tokenized local internal proxy base URL.
- Redact token-bearing proxy path segments from structured logs.

## State

- Status: verified, ready to commit/push

## Done

- Added container-reachable hosted-local proxy configuration and runtime plumbing for the hosted runner path.
- Restored tighter ingress restrictions for `__murph/local-internal-proxy`.
- Added signed user-bound local proxy tokens and tokenized bridge base URL handling.
- Removed broad localhost tunneling and broad host remapping.
- Added IPv6 loopback normalization for `[::1]`.
- Added regression coverage for signed proxy-token validation, token replay rejection, IPv6 loopback handling, and token-path log redaction.
- Proved the fix with hosted-local Linq, hosted-local Telegram, duplicate-commit E2E, targeted unit suites, package verification, and repo typecheck.

## Now

- Preparing the scoped commit and push after final diff review.

## Next

- Commit the hosted-local continuity/security fix.
- Push the scoped branch commit.

## Verification

- `env -u NODE_OPTIONS pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/local-loopback-proxy.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/runner-platform.test.ts --no-coverage`
- `env -u NODE_OPTIONS MURPH_E2E_STREAM_DEV_LOGS=1 MURPH_E2E_DEBUG_PROGRESS=1 pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local`
- `env -u NODE_OPTIONS MURPH_E2E_STREAM_DEV_LOGS=1 MURPH_E2E_DEBUG_PROGRESS=1 pnpm exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts --no-coverage`
- `env -u NODE_OPTIONS MURPH_E2E_STREAM_DEV_LOGS=1 MURPH_E2E_DEBUG_PROGRESS=1 pnpm exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts --no-coverage`
- `env -u NODE_OPTIONS pnpm typecheck`
- `env -u NODE_OPTIONS bash scripts/workspace-verify.sh test:diff apps/cloudflare scripts/dev-hosted-local`

## Notes

- Parallel execution of multiple full hosted-local suites can still collide on the shared `.dev.vars` symlink in `scripts/dev-hosted-local/main.ts`; serial execution remains green. That was observed only during local parallel test orchestration and is outside the runtime continuity root cause fixed here.
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
