# Hosted AI usage reporting secret boundary

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Fix the hosted runner trust boundary so member-supplied runner secrets cannot override the platform-only AI usage reporting secret, and domain-separate the anonymized reporting user-id HMAC.

## Success criteria

- `HOSTED_AI_USAGE_REPORTING_SECRET` is not part of the member runner-secret allowlist.
- The runner-secret policy explicitly blocks that key even when custom allowlist env is present.
- Reporting user IDs continue to be stable for the same member/secret pair while incorporating an explicit HMAC context prefix.
- The change stays scoped to the hosted env policy, assistant usage attribution helper, and directly coupled tests.

## Scope

- `apps/cloudflare/src/hosted-env-policy.ts`
- `packages/assistant-engine/src/assistant/usage-attribution.ts`
- directly coupled tests under:
  `apps/cloudflare/test/{env,hosted-env-policy,node-runner-hosted-assistant}.test.ts`
  `packages/assistant-engine/test/assistant-usage-attribution-and-scheduled-log.test.ts`

## Constraints

- Preserve unrelated dirty-tree edits, especially the active scheduled-log work already present in this checkout.
- Do not widen the forwarded assistant env profile surface beyond the supplied trust-boundary fix.
- Keep the reporting identifier anonymized and deterministic; do not introduce raw member identifiers into logs or persisted output.

## Verification

- planned: `pnpm typecheck`
- planned: `pnpm test:diff apps/cloudflare/src/hosted-env-policy.ts apps/cloudflare/test/env.test.ts apps/cloudflare/test/hosted-env-policy.test.ts apps/cloudflare/test/node-runner-hosted-assistant.test.ts packages/assistant-engine/src/assistant/usage-attribution.ts packages/assistant-engine/test/assistant-usage-attribution-and-scheduled-log.test.ts`
- planned: direct scenario proof for reserved runner-secret blocking and reporting-user-id domain separation via focused tests
- planned: `git diff --check`

## Notes

- This is a supplied review-fix landing. Keep the implementation aligned with current HEAD rather than replaying stale hunks blindly.
Completed: 2026-04-22
