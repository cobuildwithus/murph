Goal (incl. success criteria):
- Stop hosted signup/login completion from manually creating Privy embedded wallets.
- Keep hosted signup completion tolerant of missing wallet state so Telegram/email/direct whitelabel auth can finish without showing a Privy wallet setup modal.
- Success means auth completion no longer calls `createWallet`, server completion remains wallet-optional, and focused tests prove the simplified contract.

Constraints/Assumptions:
- Privy docs state automatic wallet creation does not apply to whitelabel/direct login methods, and `createWallet()` can create a user wallet later when a wallet-backed feature needs one.
- No new persisted state, auth method, or wallet feature is being added.
- Preserve existing PrivyProvider wallet config unless the code path no longer needs it changed.
- Preserve unrelated worktree edits and active ledger rows.

Key decisions:
- Remove signup-time wallet provisioning instead of hiding or delaying the modal inside auth completion.
- Leave wallet linkage as optional account metadata during hosted member identity reconciliation.
- Defer actual wallet creation to a future explicit wallet-needed surface.

State:
- Implementation and local verification complete. Awaiting completion audit results and final scoped commit.

Done:
- Confirmed Privy docs allow later programmatic wallet creation and that auto-create does not cover Murph's current whitelabel/direct auth hooks.
- Identified `ensureHostedPrivyWalletReady` / `useCreateWallet` in the hosted auth completion tail as the source of signup-time wallet setup UI.
- Removed client-side signup/auth completion wallet provisioning and set Privy embedded wallet `createOnLogin` to `off`.
- Simplified hosted client session readiness so missing wallet state is not an auth/session issue; phone completion only checks for a verified phone.
- Updated focused hosted auth tests and component mocks for the wallet-optional signup contract.
- Verification passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-privy-client.test.ts apps/web/test/hosted-onboarding-privy-provider.test.ts apps/web/test/homepage-privy-auth.test.ts apps/web/test/hosted-phone-auth.test.ts apps/web/test/hosted-auth-panel.test.ts apps/web/test/join-invite-islands.test.ts`
  - `pnpm test:diff $(git diff --name-only -- apps/web)`
  - `pnpm --dir apps/web typecheck`

Now:
- Wait for security/privacy and coverage audit subagents.

Next:
- Address audit findings if any, then commit via `scripts/finish-task`.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/privy-client.ts
- apps/web/src/components/hosted-onboarding/hosted-auth-completion.ts
- apps/web/src/components/hosted-onboarding/use-hosted-auth-completion.ts
- apps/web/src/components/hosted-onboarding/hosted-phone-auth-controller.ts
- apps/web/src/components/hosted-onboarding/hosted-phone-auth-support.ts
- apps/web/src/lib/hosted-onboarding/privy-shared-types.ts
- apps/web/test/homepage-privy-auth.test.ts
- apps/web/test/hosted-auth-panel.test.ts
- apps/web/test/hosted-onboarding-privy-client.test.ts
- apps/web/test/hosted-onboarding-privy-provider.test.ts
- apps/web/test/hosted-phone-auth.test.ts
- apps/web/test/join-invite-islands.test.ts
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
