## Goal

Align hosted web wake-status and share-facing behavior with the canonical hard-cut wake model so a missing hosted wake row is treated as absent, not implicitly `queued`.

## Scope

- `apps/web/src/lib/hosted-execution/wake-lifecycle.ts`
- `apps/web/app/api/internal/hosted-wake/status/route.ts`
- `apps/web/src/lib/hosted-share/shared-acceptance.ts`
- focused `apps/web/test/*hosted*` coverage directly related to hosted wake status or share acceptance

## Constraints

- Preserve existing completed and poisoned wake handling.
- Keep the fix limited to the web-side missing-row parity slice.
- Preserve unrelated hosted hard-cut, onboarding, pricing, and release edits already in flight.

## Verification

- Focused hosted-web tests covering missing hosted wake row status/share behavior
- App-level diff-aware verification for the touched `apps/web` slice per repo policy
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
