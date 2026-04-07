# Harden hosted onboarding send-code flow against stuck states

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Remove the main stuck-state risks from the hosted onboarding SMS start flow while keeping the UI simple and the existing privacy boundary intact.

## Success criteria

- Invite send-code keeps the durable cooldown authoritative on the server, even if the post-send cleanup request is lost.
- A failed client-side `sendCode()` attempt can roll back the current cooldown for the same attempt, and retry cleanup survives a reload or retry in the same browser.
- The code-entry step exposes a clean resend path so users are not forced into awkward manual workarounds.
- Invite send attempts fail closed on stale/invalid attempt confirmations while leaving only bounded, retryable cleanup state behind.
- Focused tests cover the send, confirm, abort, and resend behavior.

## Scope

- In scope:
- Add invite-bound send, confirm, and abort routes around the existing browser-side Privy SMS send.
- Update the hosted phone auth UI to use that lifecycle, persist pending cleanup retries locally, and expose resend from the code step.
- Add focused regression tests for the invite send lifecycle and route behavior.
- Out of scope:
- Replacing Privy SMS auth with a server-side OTP system.
- Changing invite payload privacy, billing flow, or post-Privy phone verification rules.

## Constraints

- Keep raw phone numbers out of URLs, public invite payloads, and visible invite UI copy.
- Keep the current server-side phone-match enforcement after Privy verification unchanged.
- Preserve unrelated dirty worktree edits and keep the write scope narrow.

## Risks and mitigations

1. Risk: The new attempt state could itself create a stuck flow.
   Mitigation: Keep the server cooldown authoritative, give failed sends an explicit abort path, and persist pending cleanup retries locally so the next interaction can reconcile them.
2. Risk: Adding a resend path could increase SMS spam.
   Mitigation: Preserve the durable cooldown after confirmed sends and retain the invite-bound same-origin route plus downstream Privy limits.
3. Risk: More moving parts could make the UI brittle.
   Mitigation: Reuse the same helper for initial send and resend, and centralize confirm/abort retry handling in one client-side reconciliation seam.

## Tasks

1. Add an execution-safe invite phone-code send/confirm/abort lifecycle in hosted onboarding services and routes.
2. Simplify the invite UI onto shared send/resend helpers and expose resend on the code step.
3. Persist pending confirm/abort retries in browser storage so the next interaction can recover from transient cleanup failures.
4. Add or update focused regression tests for the invite lifecycle and resend behavior.
5. Run focused verification, perform the required audit pass, and finish with a scoped commit.

## Decisions

- Start the durable cooldown when the invite-bound send request is prepared, then use confirm only to clear temporary attempt markers and abort to roll back failed sends for the same attempt id.
- Keep the one-tap invite UX and manual fallback; do not expose masked phone hints in the primary UI.
- Persist pending confirm/abort retries in browser storage so reloads and resend attempts can reconcile failed cleanup calls without exposing phone data.

## Verification

- Commands to run:
- `pnpm typecheck`
- `../../node_modules/.bin/vitest run --config vitest.workspace.ts --project hosted-web-onboarding-core test/hosted-onboarding-routes.test.ts --coverage.enabled=false` (from `apps/web`)
- `../../node_modules/.bin/vitest run --config vitest.workspace.ts --project hosted-web-onboarding-integrations test/hosted-phone-auth.test.ts --coverage.enabled=false` (from `apps/web`)
- `./node_modules/.bin/vitest run --config .tmp-invite-send-code.vitest.config.mts` with a temporary config that includes only `apps/web/test/hosted-onboarding-invite-send-code.test.ts`
- `./node_modules/.bin/eslint src/components/hosted-onboarding/client-api.ts src/components/hosted-onboarding/hosted-phone-auth.tsx src/lib/hosted-onboarding/invite-service.ts src/lib/hosted-onboarding/shared.ts app/api/hosted-onboarding/invites/[inviteCode]/send-code/{abort,confirm}/route.ts test/hosted-onboarding-routes.test.ts test/hosted-onboarding-invite-send-code.test.ts` (from `apps/web`)
- Outcomes:
- Focused route, UI, and invite-lifecycle tests passed after the robustness changes.
- `pnpm typecheck` still fails for the unrelated pre-existing `apps/web/src/lib/hosted-share/shared.ts` errors (`value` typed as `unknown`), outside this onboarding patch.
Completed: 2026-04-07
