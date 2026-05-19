## Goal

Restore the hosted settings Telegram auto-link behavior while preserving the
manual retry path, safe Privy error mapping, and visible Privy loading status.

## Constraints

- Preserve unrelated dirty hosted runner, device-sync, experiment, privacy, and
  ledger work in the checkout.
- Do not expose user identifiers, account identifiers, secret values, local
  paths, raw provider payloads, or full authorization material.
- Keep the change scoped to the Telegram settings link flow, identity-link
  dialog handoff, and focused tests.
- Preserve backend Telegram sync/auth invariants.

## Plan

1. Reintroduce the `autoLink` prop from the identity-link dialog into the
   Telegram settings card.
2. Trigger auto-link only after Privy is ready and the existing session is
   authenticated, while leaving the manual button available after errors.
   If Privy already has Telegram linked but the server snapshot is stale, sync
   Murph instead of starting a second Privy link flow.
3. Keep safe error-code mapping and loading status copy.
4. Update focused tests to assert auto-link starts after Privy readiness and
   still preserves manual behavior/error safety.
5. Run focused verification and commit a scoped follow-up.

## Verification

- `pnpm --dir apps/web test -- settings-telegram-settings.test.ts` passed
  after the final manual-retry fix; the web Vitest workspace reported 240
  files / 1898 tests passed.
- Coverage/proof review also ran
  `pnpm --dir apps/web test -- settings-identity-link-dialog.test.tsx settings-telegram-settings.test.ts`,
  which passed with 240 files / 1898 tests.
- `pnpm --dir apps/web lint` passed with the pre-existing unrelated
  `agent-session-service.ts` unused-variable warnings.
- `pnpm --dir apps/web typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff apps/web/src/components/settings/hosted-settings-identity-link-dialog.tsx apps/web/src/components/settings/hosted-telegram-card-settings.tsx apps/web/test/settings-identity-link-dialog.test.tsx apps/web/test/settings-telegram-settings.test.ts agent-docs/exec-plans/active/2026-05-19-telegram-auto-link-restore.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  passed and ran the full `apps/web verify` lane. Residual warnings were the
  same pre-existing lint warnings and Turbopack NFT trace warning outside this
  Telegram diff.

## State

- Auto-link restored for new Telegram identity-link dialogs.
- Auto-link waits for Privy readiness and authenticated session state. If Privy
  already has Telegram linked, the card syncs Murph instead of reopening the
  Privy link flow; otherwise it calls the same safe `handleLinkTelegram` path
  as the manual button.
- Manual retry, safe Privy error mapping, and visible Privy loading status are
  preserved.
Status: completed
Updated: 2026-05-19
Completed: 2026-05-19
