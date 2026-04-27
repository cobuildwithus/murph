# Cloudflare Local Proxy Hardening

## Goal

Make the hosted execution local internal proxy impossible to enable accidentally in production.

Success criteria:

- Worker startup/config initialization fails when `HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL` is set outside development.
- Local internal proxy requires explicit `ALLOW_LOCAL_INTERNAL_PROXY=true`.
- Proxy host validation accepts only loopback/private destinations.
- Focused tests cover the guard behavior.

## Constraints

- Preserve the existing per-run proxy token contract.
- Do not broaden the Worker route surface.
- Treat the proxy env as development-only.
- Preserve unrelated active Cloudflare runner/test changes in the dirty tree.

## State

Implementation and required audits complete; closing is blocked by overlapping dirty work in shared files.

## Done

- Read required repo routing, architecture, security, reliability, completion, and verification docs.
- Added a shared local proxy env guard requiring development plus `ALLOW_LOCAL_INTERNAL_PROXY=true`.
- Restricted configured local proxy base URLs to loopback/private/local bridge hosts.
- Wired the guard into Worker fetch/email startup paths and hosted environment parsing.
- Added focused env, route, and hostname coverage.
- Verified `pnpm --dir apps/cloudflare typecheck` and focused Vitest passed.
- Broader `pnpm test:diff ...` / `pnpm --dir apps/cloudflare verify` are blocked by unrelated active Health Commons collagen content generation error.
- Required `security-privacy-review`, `coverage-write`, and `task-finish-review` passes completed. Security review had no findings and the single suggested edge-case test was added.

## Now

- Decide safe close/commit handling with overlapping dirty files.

## Next

- Close the plan if a scoped commit cannot safely isolate from unrelated dirty work.

## Open Questions

- None currently.

## Working Set

- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/local-loopback-proxy.ts`
- `apps/cloudflare/src/env.ts`
- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/src/worker-contracts.ts`
- Directly coupled `apps/cloudflare/test/**`
- `agent-docs/exec-plans/active/2026-04-25-cloudflare-local-proxy-hardening.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
