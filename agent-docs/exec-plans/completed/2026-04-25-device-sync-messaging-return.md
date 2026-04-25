# Return assistant-issued device OAuth links to messaging

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- When the hosted assistant sends a WHOOP/Oura device connection link through Linq/iMessage or Telegram, the OAuth callback should return the browser to a Murph-owned messaging return page that tries to open the same messaging app instead of dropping the user on generic settings/home.
- Preserve the existing settings return path for connections started from settings or from hosted runtime wakes where no messaging source can be inferred.

## Why

- Assistant-issued wearable links are part of a chat flow. Returning to the web homepage/settings after provider OAuth interrupts the user's task and makes it unclear where to continue.
- The safe return target must stay on the Murph web origin; app-opening behavior should happen only from a fixed allowlisted Murph route, not by broadening OAuth return origins or accepting arbitrary app schemes.

## Scope

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/platform.ts`
- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/test/runner-platform.test.ts`
- `apps/web/app/api/internal/device-sync/providers/[provider]/connect-link/route.ts`
- `apps/web/app/api/device-sync/messaging-return/route.ts`
- `apps/web/test/device-sync-internal-connect-route.test.ts`
- `apps/web/test/device-sync-messaging-return-route.test.ts`
- focused assistant-runtime tests if required
- `agent-docs/exec-plans/active/{2026-04-25-device-sync-messaging-return.md,COORDINATION_LEDGER.md}`

## Out of scope

- Passing raw phone numbers, chat ids, Telegram user ids, or other messaging identifiers through OAuth state or URLs.
- Broadening device-sync OAuth allowed return origins to external domains or app schemes.
- Changing settings-page connection UX or provider OAuth scopes.

## Constraints

- Keep return targets allowlisted and same-origin until the final fixed messaging return route.
- Do not log or persist raw messaging identifiers.
- Preserve existing assistant tool API shape; the model still asks only for a provider connection link.
- Follow high-risk hosted control-plane workflow with required verification and audit passes.

## Risks and mitigations

1. Risk: A messaging return target could become an open redirect.
   Mitigation: Accept only an enum across the signed Cloudflare-to-web boundary, build the return path server-side, and keep the route targets fixed.
2. Risk: Browser app-opening behavior may vary by platform.
   Mitigation: Serve a minimal fallback page with a direct "open app" link while still attempting the handoff.
3. Risk: Existing non-chat device connect links could stop returning to settings.
   Mitigation: Infer a messaging return target only for Linq/iMessage or Telegram conversation wakes and keep the current settings fallback.

## Tasks

1. Register the lane and inspect the current hosted device-link, callback, homepage, and wake contracts.
2. Thread an optional messaging return target from hosted runtime through the Cloudflare signed callback to the web internal connect-link route.
3. Add a fixed Murph-owned messaging return route for app handoff and fallback.
4. Add focused tests for Linq/iMessage and Telegram return target selection, signed callback request bodies, and route hardening.
5. Run focused tests, typecheck, required audit passes, and close the plan with a scoped handoff.

## Verification

- Focused `apps/web` device-sync internal connect-link and messaging-return route tests.
- Focused Cloudflare runtime-platform connect-link test coverage.
- Focused assistant-runtime hosted run test coverage if runtime inference changes require it.
- `pnpm typecheck`
- Diff-aware verification command covering the touched files, unless blocked by unrelated active work.

## Current results

- Initial inspection found the assistant-issued connect-link route hardcodes `/settings?tab=wearables` as the OAuth return target.
- Homepage has no existing `redirect=imessage` app-opening behavior, so this plan uses a dedicated same-origin messaging return route instead of only adding a homepage query string.
- Implemented:
  - Linq/iMessage and Telegram conversation wakes now attach an optional messaging return target to hosted device connect-link creation.
  - Cloudflare forwards that enum in the signed internal connect-link POST body only when present.
  - The web internal connect-link route accepts only `imessage` or `telegram`, maps them to fixed same-origin `/api/device-sync/messaging-return` return paths, and preserves `/settings?tab=wearables` as the fallback.
  - The messaging return route serves a no-store/no-referrer HTML handoff page with fixed `sms:` or Telegram destinations plus a fallback link.
- Green focused verification:
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-runner.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-platform.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/device-sync-internal-connect-route.test.ts apps/web/test/device-sync-messaging-return-route.test.ts --no-coverage`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir apps/cloudflare typecheck`
  - `git diff --check -- <task paths>`
- Broader verification blockers:
  - `pnpm typecheck` fails in unrelated hosted Linq typing diagnostic tests on stale mock fields.
  - `bash scripts/workspace-verify.sh test:diff <task paths>` runs assistant-runtime tests and Cloudflare verify green, then fails in `apps/web verify` on the same unrelated hosted Linq typing tests.
- Required audits:
  - `security-privacy-review`: no findings.
  - `frontend-review`: fixed the low fallback-link hover/focus finding.
  - `simplify`: fixed the unsafe-provider test gap, removed a dead helper input, and reused the shared return-target type in Cloudflare.
  - `coverage-write`: no edits requested.
  - `task-finish-review`: no findings.
- Residual manual checks:
  - Test actual `sms:` and Telegram handoff behavior on target devices/browsers.
  - Confirm production has `TELEGRAM_BOT_USERNAME` if Telegram returns should open the bot instead of the generic Telegram entry point.
Completed: 2026-04-25
