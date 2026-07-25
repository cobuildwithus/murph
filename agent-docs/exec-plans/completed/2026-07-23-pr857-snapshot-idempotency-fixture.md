# PR 857 snapshot replay idempotency fixture

Status: completed
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Make the snapshot-publication recovery E2E model Linq's documented text-send
  idempotency contract so a restored provider turn proves replay safety and can
  continue to the later workspace-restoration assertion.

## Success criteria

- The Linq stub returns the first accepted message for an exact replay of a
  non-empty `message.idempotency_key`.
- Focused helper coverage proves that repeated requests remain observable while
  only one provider message is accepted.
- The snapshot-publication recovery E2E proves the restored provider attempt
  reuses the original key, produces one accepted first reply, publishes a clean
  snapshot, and completes the second turn.
- The owning hosted-runtime CI gate and canonical scoped verification pass on
  the pushed PR head.

## Scope

- In scope:
  `apps/cloudflare/test/helpers/hosted-local-linq-support.ts`, its focused test,
  the snapshot-publication fallback E2E, and exact-head PR evidence.
- Out of scope: production Linq dispatch ordering, provider retry policy,
  snapshot/checkpoint architecture, unrelated hosted-local assistant-provider
  stub work, deployment, or merging PR #857.

## Constraints

- Preserve the production contract that ordinary Linq text sends may re-enter
  provider dispatch only with a deterministic idempotency key.
- Keep pre-accept synthetic failures unaccepted and preserve the existing
  post-accept lost-acknowledgment control.
- Do not add a retry owner, queue, persisted state, or production behavior.

## Evidence

- Exact-head CI run `30003028546`, job `89193436060`, restored the rejected
  snapshot and issued a second first-reply HTTP request after Web reported the
  original provider dispatch already started.
- `agent-docs/references/hosted-runtime-protocol.md` defines Linq text POSTs with
  an outbox idempotency key as replay-safe.
- The current hosted-local Linq stub assigns a fresh provider message to every
  ordinary accepted POST and therefore does not model that provider contract.

## Tasks

1. Add exact idempotency-key replay behavior and focused helper coverage.
2. Assert the recovery E2E's replay key and accepted-message cardinality.
3. Run focused helper and grouped hosted-local durability checks.
4. Run canonical scoped verification, finish the plan, push, and confirm CI.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts
  apps/cloudflare/test/helpers/hosted-local-linq-support.test.ts`:
  1 file and 10 tests passed.
- `pnpm --dir apps/cloudflare typecheck`: passed.
- `MURPH_E2E_DEBUG_ASSISTANT_PROVIDER_STUB=1 pnpm hosted-local e2e
  snapshot-publication-fallback --no-bundle`: passed.
- `MURPH_E2E_DEBUG_ASSISTANT_PROVIDER_STUB=1 pnpm hosted-local e2e
  canonical-receipt-lost-ack-recovery snapshot-publication-fallback
  shutdown-checkpoint-conversation-ahead --no-bundle`: all three durability
  scenarios passed.
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff apps/cloudflare`: passed
  106 files and 1,874 tests in
  [action 30015775017](https://github.com/cobuildwithus/murph/actions/runs/30015775017).
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance`: passed in
  [action 30015973316](https://github.com/cobuildwithus/murph/actions/runs/30015973316).
Completed: 2026-07-23
Completed: 2026-07-23
