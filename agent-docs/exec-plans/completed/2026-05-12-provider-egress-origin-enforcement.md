# Provider Egress Origin Enforcement

## Goal

Enforce full provider base origins, not hostname-only matching, before the Cloudflare hosted runner injects Worker-owned provider credentials.

Success criteria:

- OpenAI and Mapbox credential injection only happens for the canonical HTTPS origin.
- Telegram and WhatsApp credential injection only happens for the configured provider origin, defaulting to the canonical HTTPS origins.
- Configured provider base URLs match by origin plus normalized path prefix.
- HTTP and nonstandard-port requests on production provider hostnames are not credential-injected.
- Focused regressions cover the blocked cases.

## Constraints

- Preserve Worker-owned provider credential boundary.
- Keep the implementation small and local to `apps/cloudflare/src/runner-egress-intercept.ts` and its focused tests.
- Preserve unrelated worktree changes and active Cloudflare runner rows.
- Allow explicit local/test HTTP provider bases only when they are configured for local/test hostnames.

## Key Decisions

- Use URL origin plus normalized base-path prefix for all provider matches.
- Default production provider bases stay HTTPS.
- Treat configured production provider HTTP origins as invalid for credential injection.
- Malformed optional provider base URL config falls back to the canonical base so one bad provider env value cannot crash unrelated outbound egress classification.

## State

Complete; ready for scoped closeout.

## Done

- Loaded required repo workflow, architecture, security, reliability, and Cloudflare guidance.
- Inspected current runner egress intercept code and focused test file.
- Added focused Telegram and WhatsApp regressions for configured path-prefixed base URLs and same-origin path-prefix misses.
- Ran focused Cloudflare verification:
  - `pnpm --dir apps/cloudflare test -- runner-egress-intercept.test.ts` passed.
  - `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts` passed.

## Now

- Close the active plan with a scoped commit.

## Next

- None.

## Open Questions

- None.

## Working Set

- `apps/cloudflare/src/runner-egress-intercept.ts`
- `apps/cloudflare/test/runner-egress-intercept.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-05-12-provider-egress-origin-enforcement.md`
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
