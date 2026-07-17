# Remove dead countHostedAccountData fan-out

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Delete the unexported, never-called `countHostedAccountData` helper in
  `apps/web/src/lib/hosted-privacy/account-data-service.ts`. It fires ~48
  concurrent `count()` queries in one `Promise.all`, which would exceed the
  15-client web connection pool instantly if any future caller wired it up.

## Success criteria

- The function and only the function is removed; the account-deletion flow,
  its counts reporting (`deleteHostedAccountPrismaRows`), and shared helpers
  (`HostedAccountDataCounts`, `buildStringInFilter`, `uniqueStrings`,
  `listOwnedHostedThreadContainerMemberIds`) are untouched and still used.
- Scoped verification passes.

## Scope

- In scope: `apps/web/src/lib/hosted-privacy/account-data-service.ts`.
- Out of scope: any behavior change to account deletion or privacy flows.
Completed: 2026-07-16
