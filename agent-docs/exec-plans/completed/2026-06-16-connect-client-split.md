# Connect Client Split

## Goal

Split the oversized hosted web connect page client component into simpler
local modules while preserving behavior, and change the Telegram action copy
from "Open Telegram" to "Text Murph".

## Scope

- `apps/web/app/(dashboard)/connect/connect-page-client.tsx`
- New focused files under `apps/web/app/(dashboard)/connect/`
- Existing connect page tests when useful

## Constraints

- Preserve current connect-page behavior except the requested Telegram label.
- Keep the split local to the connect page unless an existing shared owner is a
  clearly better fit.
- Do not touch unrelated active-plan files.

## Verification

- Stale-string/readback checks for the requested copy.
- Focused connect page tests or truthful diff-aware app verification.
- Required frontend/coverage completion review per repo workflow unless the
  final diff qualifies for the tiny copy-only exception, which this split does
  not.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
