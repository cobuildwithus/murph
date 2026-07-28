# Scope ambiguous top-up identity to the payer

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Prevent one authenticated payer in a shared browser tab from reading or
  clearing another payer's unresolved usage top-up request identity.

## Success criteria

- The browser storage slot derives from both the authenticated payer member ID
  and the exact checkout target URL.
- Personal, Family, and group entry points receive the server-resolved payer
  member ID explicitly.
- A same-tab account switch gives the second payer an independent request key
  and preserves the first payer's unresolved key.
- Returning to a terminal first-payer purchase recovers the original key and
  cannot create a second provider lifecycle.
- Focused tests, canonical verification, CI, and ReviewGPT pass against one
  exact pushed head.

## Scope

- In scope: request-identity storage scope, explicit component data flow,
  shared-storage browser regression coverage, verification, and ReviewGPT.
- Out of scope: logout storage deletion, schema changes, payment endpoints,
  new lifecycle owners, or provider behavior.

## Tasks

1. [x] Confirm the durable request identity is payer-scoped.
2. [x] Thread the authenticated payer member ID into every top-up dialog.
3. [x] Derive session-storage keys from payer and target.
4. [x] Prove same-tab account switching for personal, Family, and group.
5. [x] Run canonical verification and prepare the exact correction head for
   ReviewGPT.

## Decisions

- Retain unresolved identities across logout; deleting them would recreate the
  ambiguous-payment retry hazard.
- Use the existing member ID already owned by the authenticated server session.
  No new browser identity or payment authority is introduced.
- Keep the offer outside the storage key so a changed amount still recovers the
  original ambiguous authorization.
- The external final ReviewGPT and CI gates run against the immutable pushed
  correction after this implementation plan is archived.

## Verification

- Focused Settings, dialog, Family-manager, and group-funding tests: 181
  passed.
- Web TypeScript checking: passed.
- Touched-file ESLint: passed.
- Agent-doc drift and `git diff --check`: passed.
- Canonical `pnpm test:diff apps/web packages/assistant-engine`: passed,
  including 7,034 Web tests, the Web production build, 2,014 Cloudflare node
  tests, and 2 Cloudflare Worker tests.
- Exact-head CI and ReviewGPT: pending.
Completed: 2026-07-28
