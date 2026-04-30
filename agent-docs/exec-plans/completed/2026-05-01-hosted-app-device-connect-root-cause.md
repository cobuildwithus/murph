# Hosted App Device Connect Root Cause

## Goal

Find why a hosted WHOOP/device connect link was not generated for the assistant turn, and prove the root cause with the narrowest hosted-local E2E or direct scenario available.

Success criteria:

- Trace the hosted connect-link path from assistant runtime availability through web/device-sync issuance.
- Run the existing hosted-local device-connect E2E when feasible.
- Add or update focused E2E coverage only if the current harness misses the failure mode.
- Keep any production fix scoped to the identified broken gate.

## Scope

- Hosted app/device-connect link issuance path.
- Existing hosted-local device-connect E2E tests and directly coupled test harness only if needed.
- Assistant runtime hosted device-connect availability only if the root cause is there.

## Constraints

- Preserve unrelated dirty-tree edits and active ledger rows.
- Do not change provider OAuth semantics or introduce real WHOOP network calls in tests.
- Keep secrets and provider tokens out of logs, fixtures, and commits.

## State

Root cause found for the hosted-local connect-link failure reproduced in this lane:

- WHOOP provider config was present in hosted runtime config; the provider catalog was not the blocker.
- The connect-link POST reached the hosted web route and failed with `401 HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED`.
- The local E2E used a direct runtime-platform signer with hardcoded callback signing key id `v1`, while the hosted-local web verifier can inherit a different key id from local Cloudflare dev vars.
- Pinning `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID=v1` in the device-connect E2E fixture aligns the signer and verifier and makes the scenario deterministic.
- The E2E also asserts the generated OAuth URL omits `client_secret`, so hosted config can issue the URL without leaking the provider secret to the browser.
- An experimental full Telegram auto-reply turn was attempted but skipped before provider/helper execution (`capture.reply-skipped`), so it tested auto-reply eligibility rather than the connect-link route and was not kept.

## Verification

- PASS: focused hosted-local device-connect E2E with prepared runner bundle:
  `env -u MURPH_DEV_CF_WRANGLER_LOG_LEVEL MURPH_DEV_SKIP_RUNNER_BUNDLE=1 pnpm --dir . exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-device-connect-e2e.test.ts --no-coverage`
- PASS: `pnpm --dir apps/cloudflare typecheck`
- PASS: `git diff --check -- apps/cloudflare/test/hosted-local-device-connect-e2e.test.ts agent-docs/exec-plans/active/2026-05-01-hosted-app-device-connect-root-cause.md`
- FAIL, unrelated/setup-time: final focused E2E rerun after adding the explicit `client_secret` assertion timed out in `beforeAll` after 300s while waiting behind rotating workspace/app verification locks; the test body did not execute.
- FAIL, unrelated: `pnpm typecheck` failed in `packages/inbox-services` because `@murphai/parsers` declarations were not resolvable from `packages/inboxd` imports before Cloudflare app typecheck ran.
- FAIL, diagnostic-only/manual: ad hoc single-file `tsc` for the E2E file does not load app test aliases such as `#hosted-web-testing`; use the app typecheck and Vitest E2E commands above instead.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
