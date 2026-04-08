# Goal (incl. success criteria):
- Move hosted web Privy provider ownership to the app shell so homepage, join, share, settings, and success pages all share one app-level auth context.
- Remove page-local Privy wrappers and nested `HostedPhoneAuth` provider ownership while preserving the existing no-config fallback behavior.

# Constraints/Assumptions:
- This is an auth/provider-boundary change, so keep behavior changes narrow.
- Preserve unrelated in-flight edits in `apps/web/app/layout.tsx` and nearby hosted-auth files.
- Do not redesign invite/session logic in the same change.

# Key decisions:
- Mirror the sibling app pattern with a dedicated app-level `providers.tsx` wrapper mounted from `app/layout.tsx`.
- Keep `HostedPrivyProvider` as the Privy config owner, but move where it is mounted.
- `HostedPhoneAuth` should assume an app-level provider instead of optionally mounting its own.

# State:
- completed

# Done:
- Confirmed `apps/web` currently mounts `HostedPrivyProvider` per-page and sometimes inside `HostedPhoneAuth`.
- Confirmed join success already calls `usePrivy()` without its own page-local provider, which reinforces the need for an app-level boundary.
- Read the sibling `apps/web/app/providers.tsx` pattern and `layout.tsx` usage from the referenced repo.
- Added `apps/web/app/providers.tsx` and mounted it from `apps/web/app/layout.tsx`.
- Removed page-local Privy providers from hosted join/share/settings pages and removed nested provider ownership from `HostedPhoneAuth`.
- Tightened the root layout to require the full hosted Privy phone-auth config so partial config fails fast instead of advertising a broken auth entrypoint.
- Updated hosted-web tests for the new provider ownership and fail-fast config seam.
- Scoped verification passed:
  - `pnpm --config.verify-deps-before-run=false --dir apps/web typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir apps/web lint` (warnings only, pre-existing)
  - `pnpm --config.verify-deps-before-run=false exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/layout.test.ts apps/web/test/page.test.ts apps/web/test/join-page.test.ts apps/web/test/settings-page.test.ts apps/web/test/hosted-onboarding-landing.test.ts apps/web/test/hosted-onboarding-privy.test.ts apps/web/test/hosted-phone-auth.test.ts apps/web/test/join-invite-client.test.ts`
- Required review pass found a partial-config gap; fixed locally by requiring the full hosted Privy phone-auth config in the root layout and re-running scoped verification.

# Now:
- Close the plan and create the scoped commit.

# Next:
- None.

# Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether any existing tests rely on `HostedPhoneAuth` owning its own provider boundary.

# Working set (files/ids/commands):
- `apps/web/app/layout.tsx`
- `apps/web/app/providers.tsx`
- `apps/web/app/join/[inviteCode]/page.tsx`
- `apps/web/app/share/[shareCode]/page.tsx`
- `apps/web/app/settings/page.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth.tsx`
- `apps/web/src/components/hosted-onboarding/join-invite-stage-panels.tsx`
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
