Goal (incl. success criteria):
- Reframe hosted data deletion as full account deletion: "Delete account (and all your data)".
- Actually wipe vendor accounts: cancel the Stripe subscription before local deletion (abort if it fails so no subscription keeps billing a deleted account), then delete the Stripe customer and the Privy user best-effort after the local wipe, reported in the deletion result.
- Simplify the confirm dialog to a single step with only the typed phrase (now `DELETE MY ACCOUNT`); drop both acknowledgement checkboxes end-to-end (UI + request schema).
- Replace the verbose post-deletion summary with a one-line confirmation and a redirect to the home page; the session is already revoked server-side.

Constraints/Assumptions:
- Keep ordering safe: no provider-record deletion that can strand a billed-but-deleted or deleted-but-billed state. Subscription cancel is pre-commit fail-closed; customer/Privy deletion is post-commit best-effort and reported.
- Reuse existing seams: `readHostedMemberStripeBillingRef`, `readHostedMemberIdentity`, `getHostedOnboardingStripe`, Privy management client in `privy.ts`.
- No schema/db changes. Bump deletion result schema string to v2.
- Preserve unrelated worktree edits and ledger rows.

Key decisions:
- `stripe.customers.del` after commit (cancels nothing extra by then; subscription already canceled pre-commit).
- Privy user deletion via new exported helper in `hosted-onboarding/privy.ts` so the management client stays private.
- Treat Stripe `resource_missing` as skipped_no_record, not failure.

State:
- In progress.

Done:
- Reviewed deletion service, route, UI, Privy/Stripe seams.

Now:
- Implement backend + UI + tests + docs.

Next:
- Verification (test:diff, typecheck), audits, finish-task, PR.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-privacy/account-data-shared.ts
- apps/web/src/lib/hosted-privacy/account-data-service.ts
- apps/web/src/lib/hosted-onboarding/privy.ts
- apps/web/src/components/settings/hosted-data-privacy-settings.tsx
- apps/web/app/api/settings/privacy/delete/route.ts
- apps/web/test/hosted-account-data-service.test.ts
- apps/web/test/settings-privacy-delete-route.test.ts
- apps/web/test/hosted-data-privacy-settings.test.ts
- docs/hosted-account-data-deletion-export.md
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
