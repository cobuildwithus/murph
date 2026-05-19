## Goal

Fix the hosted settings Telegram link action so an authenticated user can start
the Privy Telegram account-link flow from an explicit button click, and make
failure messages specific enough to diagnose Privy configuration/runtime issues.

## Constraints

- Preserve unrelated dirty hosted runner, device-sync, experiment, and local
  harness work in the checkout.
- Do not expose user identifiers, account identifiers, secret values, local
  paths, raw provider payloads, or full authorization material in code, tests,
  logs, docs, or review output.
- Keep the fix scoped to hosted settings Telegram linking unless runtime
  evidence proves a shared Privy provider issue.
- Do not weaken Privy authentication or backend sync invariants for tests.

## Plan

1. Confirm the installed Privy Telegram link API behavior and the existing
   settings tests around `linkTelegram`.
2. Remove fragile automatic Telegram link attempts from the settings dialog so
   the OAuth redirect starts from a user gesture.
3. Preserve backend sync behavior while mapping known Privy link error codes to
   safe user-facing copy and keeping generic copy for unknown provider errors.
4. Add focused regression coverage for manual-click-only behavior and specific
   link failure messaging.
5. Run focused web tests, typecheck, required review/audit passes, and scoped
   verification.

## Verification

- `pnpm --dir apps/web test -- settings-telegram-settings.test.ts` passed
  after the implementation and again after review fixes; the web Vitest
  workspace reported 240 files / 1892 tests passed on the final run.
- `pnpm --dir apps/web typecheck` passed after review fixes.
- `pnpm --dir apps/web lint` passed with the pre-existing unrelated
  `agent-session-service.ts` unused-variable warnings.
- `bash scripts/workspace-verify.sh test:diff apps/web/src/components/settings/hosted-settings-identity-link-dialog.tsx apps/web/src/components/settings/hosted-telegram-card-settings.tsx apps/web/src/components/settings/hosted-telegram-settings.tsx apps/web/src/components/settings/hosted-telegram-settings-helpers.ts apps/web/test/settings-telegram-settings.test.ts agent-docs/exec-plans/active/2026-05-19-telegram-link-button.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  passed; it ran the full `apps/web verify` lane. Residual warnings were the
  same pre-existing lint warnings and Turbopack NFT trace warning outside this
  Telegram diff.

## State

- Removed automatic Telegram link attempts from the hosted identity link dialog
  and settings card.
- Telegram link errors from Privy callbacks now use allowlisted, safe copy for
  known codes and generic copy for unknown provider errors.
- Restored a neutral "Preparing Telegram linking..." status while Privy is not
  ready so the disabled button has a visible explanation.
- Focused settings tests updated for manual-click-only linking and callback
  error messaging.
Status: completed
Updated: 2026-05-19
Completed: 2026-05-19
