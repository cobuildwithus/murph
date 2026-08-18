# Terminate expired device setup webhook retries

Status: completed
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Stop webhooks for expired, incomplete device-provider setups from retrying
  forever while preserving the existing proof-verified setup completion and
  established-connection behavior.

## Success criteria

- The device-sync lifecycle owner distinguishes live pending setup from expired
  incomplete setup at webhook admission without adding another state owner.
- Live `pending_link` and `link_returned` setup remains retryable and inert.
- Expired incomplete setup consumes the webhook trace without dirty state,
  wake, signal, mailbox, or canonical health writes.
- Established, disconnected, reauthorization-required, and source-addition
  behavior remains unchanged.
- Focused tests and typechecks pass; exact-head ReviewGPT and required CI are
  green before completion.

## Scope

- In scope: shared device-sync ingress lifecycle classification, hosted proof at
  the real Web/Postgres adapter boundary, matching durable contract docs, and
  the encrypted Queue redrive precondition.
- Out of scope: automatic deletion/disconnection of stale connections, database
  schema changes, provider-specific cleanup, Queue consumer redesign, or direct
  production redrive.

## Constraints

- Technical constraints: preserve fail-closed authority checks, trace
  idempotency, consent and source gates, database-only bounded transactions,
  and provider-generic lifecycle ownership.
- Product/process constraints: prefer deletion and the smallest owner-bound
  predicate; do not invent a cleanup daemon, retry registry, or second queue.

## Risks and mitigations

1. Risk: treating a still-valid setup as terminal can lose the provider event
   that confirms or follows setup.
   Mitigation: compare the persisted setup expiry against the original webhook
   receipt instant and keep every unexpired pending setup retryable.
2. Risk: acknowledging expired setup could accidentally admit health effects.
   Mitigation: complete only the claimed trace and prove no dirty, wake, signal,
   mailbox, job, or canonical import effect occurs.
3. Risk: hosted and local adapters diverge.
   Mitigation: put the classification in the shared lifecycle owner and run
   shared plus hosted adapter proof.

## Tasks

1. Ask ReviewGPT to implement the smallest shared-owner patch and tests.
2. Inspect the returned patch against current lifecycle, retry, and authority
   contracts; simplify or reject any extra machinery.
3. Run focused shared and hosted device-sync proof plus typechecks.
4. Commit, push, open the PR, and run preliminary specialist and final
   ReviewGPT concurrently with exact-head CI.
5. Resolve accepted findings, establish mergeability, and retain the DLQ until
   the production fix is deployed and bounded redrive is authorized.

## Decisions

- Do not mutate the four stale production rows during implementation. The code
  owner must first make their webhook disposition terminal and replay-safe.
- Do not use setup expiry to revoke a valid callback. This task changes webhook
  admission only; the existing proof-verified callback remains the setup owner.
- Use the prepared webhook's authenticated receipt instant, not dequeue or
  redrive time, so queue delay cannot reinterpret an event across the expiry
  boundary.
- Keep malformed or missing setup expiry retryable. Only a persisted, valid
  expiry proves that an incomplete setup is terminal.
- Accept ReviewGPT's implementation artifact after parent inspection confirmed
  that it adds one shared predicate and reuses the existing trace-completion
  owner without new state, services, provider branches, or cleanup machinery.

## Verification

- Commands to run: focused `device-syncd` public-ingress tests, focused hosted
  Web device-sync tests, affected package/app typechecks, exact-head required
  GitHub checks, and current-base merge-tree proof.
- Expected outcomes: an expired pending setup completes only its trace and
  returns accepted/duplicate semantics on replay; a non-expired pending setup
  remains retryable; no unrelated lifecycle behavior changes.
- Passed: `pnpm --dir packages/device-syncd exec vitest run --config
  vitest.config.ts --no-coverage test/public-account.test.ts
  test/public-ingress.test.ts` (87 tests).
- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --project
  hosted-web-sync-settings --no-coverage
  apps/web/test/device-sync-hosted-wake.test.ts` (162 tests).
- Passed: `pnpm --filter @murphai/device-syncd typecheck`.
- Passed: `pnpm --filter @murphai/hosted-web typecheck`.
- Passed: focused hosted-web ESLint for the changed implementation and test.
- The first hosted-web focused-test attempt stopped before collecting tests
  because the fresh worktree had not generated Prisma Client. The required web
  typecheck generated it, and the unchanged focused command then passed.
- An optional `pnpm --dir apps/web lint -- <paths>` attempt expanded to the full
  app tree and was stopped after several silent minutes. The exact-path ESLint
  invocation passed; broad PR checks remain CI-owned.
Completed: 2026-08-15
