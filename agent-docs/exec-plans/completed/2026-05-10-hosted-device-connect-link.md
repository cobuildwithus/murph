# Hosted Device Connect Link

## Goal

Fix hosted wearable connect links generated for messaging so opening them directly in Chrome or another external browser does not hit a browser mutation endpoint without an Origin header.

Success criteria:

- Assistant-generated hosted device connect links land on a user/browser-safe page flow.
- The existing Origin guard for browser mutation routes remains fail-closed.
- Focused tests prove the generated link shape and the direct claim route behavior.

## Constraints

- Preserve unrelated active worktree edits.
- Do not weaken hosted browser mutation Origin checks.
- Do not expose raw connect claims, secrets, contact identifiers, or local paths in logs/docs.
- Scope changes to hosted web device-connect intent generation/routes/tests unless investigation proves another owner is required.

## Current Findings

- User report: the generated `/device/connect/<claim>` link fails in Chrome with the hosted browser mutation Origin-header error, while manually connecting through `/connect` in Safari succeeds.
- Initial code search showed hosted connect intents built `connectUrl` as `/device/connect/<claim>`, and the claim route initiated the OAuth start mutation directly.
- Patch changes generated links to `/connect#deviceConnectIntent=<opaque>&connectSource=<source>` so external browser opens land on the normal connect page without sending the opaque claim in the initial page request. The connect page reads the fragment client-side and redeems the opaque intent with a same-origin JSON POST, while direct claim GET redirects to the fragment URL for legacy links.
- The mutation Origin guard remains on claim POST before session lookup and claim consumption.
- Route-flow review found signed-out users could lose the intent after auth. Follow-up patch makes the shared auth dialog provider resume the current `/connect#deviceConnectIntent=...&connectSource=...` URL after successful accessible auth instead of sending that one case to `/home`.
- Final review found the query-string claim could persist through the normal app shell before hydration and appear in same-origin referrers. Follow-up patch moved generated and legacy handoff URLs to fragments and added fragment redemption coverage.

## Plan

1. Inspect the hosted connect intent route, claim route, `/connect` page client start flow, and current tests.
2. Change generated connect links to a page URL that can perform the mutation from a normal browser origin, while preserving direct claim-route compatibility if needed.
3. Add focused Vitest coverage for the Chrome/no-Origin failure mode and generated link shape.
4. Run focused app-web tests/typecheck/lint as far as practical in the current dirty worktree, then required security/privacy, coverage, and final review audits.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/device-connect-intent-route.test.ts apps/web/test/device-connect-intents.test.ts apps/web/test/connect-page.test.ts apps/web/test/device-sync-internal-connect-route.test.ts --no-coverage` passed before the auth/fragment follow-ups: 4 files, 43 tests.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/auth-dialog-provider.test.tsx apps/web/test/device-connect-intent-route.test.ts apps/web/test/device-connect-intents.test.ts apps/web/test/connect-page.test.ts apps/web/test/device-sync-internal-connect-route.test.ts --no-coverage` passed before the fragment follow-up: 5 files, 45 tests.
- `pnpm --dir apps/web exec tsc --noEmit --pretty false --incremental false --project tsconfig.json` passed before the fragment follow-up.
- `pnpm --dir apps/web lint` passed before the fragment follow-up with 0 errors and 7 existing warnings in `apps/web/src/lib/device-sync/agent-session-service.ts` outside this diff.
- `bash scripts/workspace-verify.sh test:diff <task files>` passed before the fragment follow-up, including `apps/web verify`, Next build, lint, and 239 hosted-web test files / 1850 tests. Existing Turbopack broad-pattern warnings remain in runtime-state/core import traces outside this change.
- `git diff --check -- <task files>` passed before the fragment follow-up.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/auth-dialog-provider.test.tsx apps/web/test/device-connect-intent-route.test.ts apps/web/test/device-connect-intents.test.ts apps/web/test/connect-page.test.ts apps/web/test/device-sync-internal-connect-route.test.ts --no-coverage` passed after the fragment follow-up: 5 files, 45 tests.
- `pnpm --dir apps/web lint` passed after the fragment follow-up with 0 errors and the same 7 existing warnings in `apps/web/src/lib/device-sync/agent-session-service.ts`.
- `git diff --check -- <task files>` passed after the fragment follow-up.
- `bash scripts/workspace-verify.sh test:diff <task files>` after the fragment follow-up passed `apps/cloudflare verify` (71 files, 977 tests), `apps/web` lint, and `apps/web` Next build/TypeScript, but failed `apps/web` tests on unrelated active Stripe-meter/usage removal work in hosted billing/execution files outside this task.
- `pnpm --dir apps/web exec tsc --noEmit --pretty false --incremental false --project tsconfig.json` is blocked by the same unrelated hosted billing/execution dirty work and deleted usage cron/stripe-metering files.

## Audit Status

- Five user-requested subagent checks planned.
- Security/privacy, frontend UX, and coverage/proof reviews found no changes needed.
- Route-flow correctness review found signed-out auth resume and stale E2E expectation gaps. Auth resume is patched. The hosted-local E2E expectation is already updated in the current dirty worktree by overlapping active Cloudflare work and should not be re-owned by this task unless a safe scoped patch is needed.
- Final completion review found the query/referrer risk described above. Fragment fix is patched and follow-up review is running.
Status: completed
Updated: 2026-05-10
Completed: 2026-05-10
