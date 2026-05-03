## Goal

Keep hosted settings display state sourced from Murph app-session-backed database snapshots and optimistic local sync results, while preserving Privy only for identity-linking proof during explicit link/sync actions.

## Scope

- `apps/web/src/components/settings/hosted-account-settings-cards.tsx`
- `apps/web/src/components/settings/hosted-settings-identity-link-dialog.tsx`
- `apps/web/src/components/settings/hosted-phone-settings.tsx`
- `apps/web/src/components/settings/hosted-email-settings*.ts*`
- `apps/web/src/components/settings/hosted-telegram-card-settings.tsx`
- focused hosted settings tests

## Constraints

- Do not use Privy client `user` as account display authority.
- Keep server routes authoritative: app-session-only for account access, and app-session plus fresh same-member Privy proof for identity sync mutations.
- Preserve explicit Privy link/update flows for phone, email, and Telegram.
- Preserve unrelated active hosted auth/sidebar work in the dirty checkout.

## Verification

- Focused settings component/helper tests passed.
- Hosted web typecheck passed.
- `test:diff` was run and failed outside this lane on a separate active-plan ledger mismatch and CLI runtime artifact preparation.
Status: completed
Updated: 2026-05-03
Completed: 2026-05-03
