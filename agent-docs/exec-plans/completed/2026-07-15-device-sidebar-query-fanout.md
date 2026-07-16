# Device Sidebar Query Fanout

## Goal

Replace the authenticated dashboard sidebar's full device-settings load with a
narrow summary projection that uses a constant number of database queries and
never reads or decrypts external account ids or provider credentials.

## Constraints

- Preserve the existing sidebar status messages, provider labels, attention
  states, authentication, and no-store response behavior.
- Use one member-scoped connection query plus at most one batched source query.
- Keep the full Settings and `/connect` data contract intact.
- Do not add shared client state merely to seed the persistent sidebar from the
  child `/connect` page.
- Do not widen into hosted runtime snapshot or device-sync execution changes.

## Plan

1. Add a narrow Prisma connection projection and a batched source reader for
   sidebar status.
2. Route only the sidebar summary endpoint through that projection while
   preserving the existing pure status summarizer.
3. Add deterministic query-count and secret-selection coverage for zero, one,
   and multiple connections.
4. Run the scoped hosted-web verification, required completion audits, local
   final review, and the PR ReviewGPT/CI loop.

## Verification

- Focused device-sync route/service/store tests: 36 passed.
- Hosted-web typecheck, dependency/boundary guards, dev smoke, lint, and
  production build passed. The full app suite passed 5,212 tests before an
  unrelated pre-existing Family settings timer fired after jsdom teardown.
- Direct source inspection proved that the sidebar query excludes encrypted
  secret fields and performs no per-connection database work.
- `coverage-write` added a full-Settings batching regression and reported no
  remaining proof gaps.
- `frontend-review` reported no findings and confirmed the visible contract,
  authentication, no-store behavior, and provider/status inputs are preserved.
- PR CI and ReviewGPT remain the final post-push gates.

## State

Implementation and local verification complete; awaiting PR CI and ReviewGPT.
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
