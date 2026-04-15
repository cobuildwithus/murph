# Homepage Sign-In Dialog Telegram

## Goal

Extend the hosted homepage sign-in dialog so it exposes Telegram alongside the existing phone and email sign-in options.

## Why

- The shared hosted Telegram auth button already supports `intent: "signin"`.
- The homepage sign-in dialog currently hides that existing sign-in path even though signup already exposes Telegram through the shared auth panel.
- Reusing the existing shared auth composition keeps the public auth surface consistent without introducing a separate Telegram-specific sign-in flow.

## Scope

- `apps/web/src/components/hosted-onboarding/hosted-existing-account-sign-in-dialog.tsx`
- focused `apps/web/test/**` coverage for the sign-in dialog method set

## Constraints

- Keep this as a narrow UI-composition change.
- Reuse the existing shared hosted auth panel and Telegram button rather than adding a parallel implementation.
- Preserve unrelated dirty hosted-onboarding files already in progress elsewhere in `apps/web`.

## Plan

1. Update the homepage sign-in dialog copy and method configuration to include Telegram.
2. Update the focused sign-in dialog regression test to assert phone, Telegram, and email are all present.
3. Run focused proof for the touched slice, then close the plan and commit only the task files.

## Verification Target

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-existing-account-sign-in-dialog.test.ts`
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
