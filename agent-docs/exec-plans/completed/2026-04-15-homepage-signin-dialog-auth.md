# Homepage Sign-In Dialog Auth Methods

## Goal

Update the hosted homepage sign-in dialog so it reuses the same auth-panel component family as signup and supports both phone and email sign-in paths.

## Why

- The signup panel already exposes the shared hosted auth UI for multiple methods.
- The sign-in dialog currently hard-codes a phone-only variant, which creates an inconsistent public auth surface.
- Reusing the same panel keeps the dialog aligned with the existing Privy-backed flows instead of maintaining a bespoke sign-in UI.

## Scope

- `apps/web/src/components/hosted-onboarding/hosted-existing-account-sign-in-dialog.tsx`
- focused `apps/web/test/**` coverage for the sign-in dialog / hosted auth panel behavior

## Constraints

- Preserve the existing hosted phone and email completion flows; this is a UI-composition change, not a new auth backend.
- Support phone and email explicitly for sign-in. Do not widen the dialog to unrelated methods unless the existing flow already requires it.
- Preserve unrelated dirty hosted-onboarding edits already in progress elsewhere in `apps/web`.

## Plan

1. Update the sign-in dialog copy and panel configuration so it mirrors the signup component structure while limiting methods to phone and email.
2. Add focused tests that assert the sign-in dialog exposes both supported methods.
3. Run the truthful `apps/web` verification lane for the touched slice, then complete the required audit/commit workflow.

## Verification Target

 - `pnpm test:diff apps/web/src/components/hosted-onboarding/hosted-existing-account-sign-in-dialog.tsx apps/web/test/hosted-existing-account-sign-in-dialog.test.ts`
- `pnpm --dir apps/web verify` if the diff-aware lane is not truthful or fails to cover the touched slice
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
