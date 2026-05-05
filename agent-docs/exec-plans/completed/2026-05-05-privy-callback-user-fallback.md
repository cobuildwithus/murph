# Privy callback user fallback

Status: completed
Created: 2026-05-05
Updated: 2026-05-06

## Goal

- Harden adjacent Privy client flows against stale `refreshUser()` snapshots after the Telegram sync race fix.

## Success criteria

- Hosted auth completion can use the Privy login callback user when immediate refresh is stale.
- Settings email linking/updating uses the Privy callback/result user when immediate refresh is stale.
- Changes stay small, composable, and do not weaken server-side session checks.
- Focused tests and typecheck pass, or unrelated blockers are reported.

## Scope

- In scope:
  - `apps/web/src/components/hosted-onboarding/hosted-auth-completion.ts`
  - hosted email, Telegram, and phone auth client components/controllers
  - settings email controller
  - focused tests for these flows
- Out of scope:
  - Broad onboarding redesign
  - unrelated active checkout work

## Constraints

- Preserve existing dirty edits in `hosted-email-auth-button.tsx`.
- Do not expose identifiers, tokens, or raw production data.
- Keep callback payloads as freshness hints only; server routes remain the persisted-truth boundary.

## Risks and mitigations

1. Risk: Client callback payload is treated as authorization truth.
   Mitigation: Use it only for client readiness and expected sync values; server routes still verify Privy/session state.
2. Risk: Special-case logic spreads across components.
   Mitigation: Centralize hosted auth user selection in `completeHostedPrivyAuth`; keep settings email fallback local to email display-state selection.

## Tasks

1. Register scope and inspect overlap.
2. Add completed-user fallback to hosted auth completion.
3. Wire login callbacks for email, Telegram, and SMS hosted auth.
4. Harden settings email callback/result fallback.
5. Add focused regressions and run verification.

## Decisions

- Prefer a refreshed user when it satisfies the needed readiness check; otherwise use the Privy callback/result user as the immediate completion payload.
- Keep server-side completion and settings sync routes as the authority for persisted identity state; callback users are only client freshness hints.
- Use one shared hosted-auth completion selector rather than repeating callback/refresh precedence in every login component.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage settings-email-settings.test.ts homepage-privy-auth.test.ts homepage-email-auth-button.test.tsx homepage-telegram-auth-button.test.tsx hosted-phone-auth.test.ts` passed.
- `pnpm --dir apps/web typecheck` passed.
Completed: 2026-05-06
