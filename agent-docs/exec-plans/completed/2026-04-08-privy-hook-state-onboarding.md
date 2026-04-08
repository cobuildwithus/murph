# Remove hosted onboarding Privy self-refresh calls and rely on SDK hook state

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Simplify hosted phone signup so it trusts Privy's client hook state instead of explicitly calling `refreshUser()` during onboarding session inspection and finalization.

## Success criteria

- Hosted onboarding does not call `refreshUser()` just to inspect or resume the current Privy signup session.
- The authenticated signup UI derives its session issue from the current Privy hook state only.
- Finalization keeps wallet creation best-effort, but no longer re-fetches the Privy user record before or after that step.
- Focused hosted onboarding tests pass and verification covers the changed auth path.

## Scope

- In scope:
- `apps/web` hosted onboarding client-side Privy session handling.
- Focused tests for the hosted phone auth flow and Privy client helpers.
- Out of scope:
- Hosted settings surfaces that still use `refreshUser()` for email or Telegram linking.
- Broader transport or server-side Privy auth changes.

## Constraints

- Technical constraints:
- This hosted app uses Privy local-storage sessions and should lean on SDK-provided hook state.
- Keep wallet creation best-effort for users without an embedded wallet.
- Product/process constraints:
- Preserve unrelated hosted-web worktree edits and adjacent hosted auth work.

## Risks and mitigations

1. Risk: Removing explicit `refreshUser()` could leave the UI blind to a just-created wallet.
   Mitigation: Treat missing wallet as continuable in the client and keep server-side completion retry handling for any Privy propagation lag.
2. Risk: `authenticated` may briefly be true before `useUser()` has hydrated.
   Mitigation: Treat missing local user details as an indeterminate but continuable state instead of forcing an extra client refresh.

## Tasks

1. Refactor the hosted Privy client helper to read session state from the current hook data only.
2. Remove onboarding-side `refreshUser()` session inspection and finalization dependencies.
3. Update focused tests to assert the new hook-driven behavior.
4. Run focused hosted-web verification and a final audit review.

## Decisions

- Prefer the Privy SDK's current local hook state over explicit client-triggered session refreshes during signup.
- Keep the backend `/privy/complete` retry loop as the source of truth for residual server-side Privy lag.
- Treat non-null but partially hydrated Privy user shells as indeterminate until linked accounts are actually present, so signup UI state does not jump to restart/manual-resume too early.

## Verification

- Commands to run:
- `pnpm --dir apps/web test -- --run test/hosted-onboarding-privy-client.test.ts test/hosted-phone-auth.test.ts`
- `pnpm --dir apps/web verify`
- Actual outcomes:
- `pnpm --dir apps/web test -- --run test/hosted-onboarding-privy-client.test.ts test/hosted-phone-auth.test.ts` passed before review and passed again after the partial-user hydration fix.
- `pnpm --dir apps/web verify` passed before review and passed again after the partial-user hydration fix. The lane still emitted the same pre-existing lint warnings and Turbopack NFT warnings, but exited successfully.

## Review follow-up

- Final review found one medium issue: the hook-only path was still treating a non-null but partially hydrated Privy user shell as a fully loaded session.
- Resolved by requiring an actual linked-account snapshot before deriving a hosted onboarding session issue, and by adding focused coverage for that indeterminate-shell case.
Completed: 2026-04-08
