## Goal

Finish the concrete hosted hard-cut follow-up from the watched ChatGPT thread by landing only the remaining wake-first cleanup that is still applicable in the current tree.

## Scope

- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/src/lib/linq/control-plane.ts`
- related `apps/web/prisma/**` and focused `apps/web/test/**`
- `packages/assistant-runtime/src/hosted-runtime/events/**`
- `packages/inboxd/src/connectors/linq/**`
- focused `packages/{assistant-runtime,inboxd}/test/**`
- `apps/cloudflare/src/user-runner/**` only if the current tree still has a clearly safe runner-meta reduction that the guide and live code both support

## Constraints

- Preserve overlapping hosted onboarding/auth/pricing work already in flight.
- Keep changes scoped to thread-returned wake-first cleanup; do not reopen unrelated hosted refactors.
- Treat the current dirty worktree as the source of truth for partially landed follow-up work and build on top of it carefully.
- Keep web as the canonical owner of wake/cursor truth and avoid moving product truth into runtime or Durable Object state.

## Verification

- Focused `apps/web` verification for hosted onboarding webhook/control-plane changes
- Focused `packages/assistant-runtime` and `packages/inboxd` verification for hosted conversation normalization changes
- Any additional Cloudflare verification only if a real runner-state change lands
- Repo-required completion audits before handoff

## Progress

- Removed the extra `apps/web` webhook-event store path from the live cutover flow instead of restoring it.
- Kept the wake-first direct path in `apps/web` and aligned `packages/inboxd` + `packages/assistant-runtime` with canonical Linq wake payload handling.
- Updated focused `apps/web`, `packages/assistant-runtime`, and `packages/inboxd` tests to match the direct wake-first cleanup.
- Removed the empty `apps/web/prisma/migrations/202604190900_hosted_webhook_ingress_event_gate/` stub.

## Verification Results

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/linq-control-plane.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts --no-coverage` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-typing.test.ts test/hosted-runtime-runner.test.ts` passed.
- `pnpm --dir packages/inboxd exec vitest run test/linq-connector.test.ts` passed.
- `pnpm --filter @murphai/inboxd typecheck` passed.
- `pnpm --filter @murphai/assistant-runtime typecheck` passed.
- `pnpm --filter @murphai/hosted-web typecheck:prepared` is still blocked by pre-existing missing module/type declarations for `@privy-io/react-auth`, `@privy-io/node`, and `@cobuild/wire` in unrelated `apps/web` files.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
