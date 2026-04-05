# Hosted Gateway Outbox Reference Cut

## Goal

Complete the hosted outbox hard cut for `gateway.message.send` so hosted outbox payload policy never persists gateway message body content inline, and keep the shared hosted-execution contract as the canonical owner of that rule.

## Scope

- `packages/hosted-execution/src/{outbox-payload.ts,dispatch-ref.ts,contracts.ts,parsers.ts}`
- `apps/web/src/lib/hosted-execution/{outbox-payload.ts,outbox.ts,dispatch.ts,hydration.ts}`
- focused tests under `packages/hosted-execution/test/**` and `apps/web/test/**`

## Constraints

- Greenfield cut only. No inline compatibility lane for `gateway.message.send`.
- Preserve unrelated dirty-tree edits in the shared worktree.
- Do not touch Cloudflare queue metadata files unless a shared contract update is strictly required.
- Keep `HOSTED_CONTACT_PRIVACY_KEY` behavior untouched.

## Invariants

- Shared hosted-execution package remains the canonical outbox payload policy owner.
- `gateway.message.send` outbox storage is reference-first and cannot persist message text inline through the shared policy.
- Hosted web hydration fails closed if it cannot safely rehydrate a reference payload.

## Verification

- Required high-risk repo baseline: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Focused proof from shared/web tests around outbox serialization and hydration behavior.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
