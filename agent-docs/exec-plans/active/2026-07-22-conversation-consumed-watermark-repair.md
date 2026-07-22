# Conversation Mailbox Consumed-Watermark Repair

Status: active
Updated: 2026-07-22

## Why

After a hosted runtime reload, Telegram replies can be delayed by minutes while
already imported conversation rows are replayed. Read-only production
aggregates show that current conversation checkpoints commonly report an
imported sequence ahead of the durable conversation `consumed_seq`; traced
Telegram rows also have no provider delivery-time `consumed_at` authority.

The current application must be traced end to end before choosing whether the
durable prefix should advance, be removed, or be replaced. The repair must
preserve pending reply work and the existing exact-row Linq delivery authority.

## Classification

High-risk, cross-cutting hosted-runtime persistence and retry correction. It
crosses the assistant runtime checkpoint producer and Web checkpoint consumer,
and correctness depends on ordering, CAS behavior, cold restore, external
delivery outcomes, and mixed conversation channels.

## Evidence and decision gate

1. Inspect all writers and readers of conversation `consumed_seq`, item
   `consumed_at`, imported/checkpoint watermarks, mailbox fetch/import, and
   reply-delivery outcomes, including the relevant removal history.
2. Obtain an independent ReviewGPT bug-hunt recommendation from an attached
   repository snapshot without supplying a preferred implementation.
3. Reconcile that recommendation against a focused failing regression test and
   the current code path before editing production behavior.

## Required behavior

- Never acknowledge assistant input that is still pending, retryably blocked,
  or not durably represented by a successful checkpoint.
- Preserve deliberate terminal no-reply/suppression behavior without forcing a
  provider delivery callback.
- Preserve exact-item Linq `consumed_at` semantics and mixed Linq/Telegram
  conversation ordering.
- Remain safe across late inbound arrival, checkpoint CAS conflict/rollback,
  warm continuation, and cold restore.
- Use the existing checkpoint/ownership path where possible; do not introduce a
  scheduler, queue, table, or per-provider state machine without evidence.
- Do not add a new user-visible reply-path network round trip.

## Expected scope

- `packages/assistant-runtime/src/hosted-runtime/pending-input-index.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `apps/web/src/lib/hosted-workspace/store.ts`
- Focused assistant-runtime and Web checkpoint/mailbox tests
- Durable hosted-runtime protocol/architecture documentation only if the
  persisted checkpoint contract changes

## Verification and completion

- Start with a regression test that proves the missing durable conversation
  acknowledgment on current `main`.
- Run focused owner tests and typechecks while implementing.
- Run the truthful `pnpm test:diff ...` lane and `pnpm verify:acceptance`, plus
  a production-faithful restart/replay scenario when the harness supports it.
- Run required `coverage-write` and `product-experience-review` local audit
  passes. Use PR-lane ReviewGPT as the sole cross-cutting gate; do not also run
  local `deep-review`.
- Commit with `scripts/finish-task`, push the isolated branch, open a draft PR,
  and complete the exact-head ReviewGPT/CI loop.

## Deployment concern to resolve

If the repair extends the checkpoint contract, prove mixed-version behavior and
document the safe Web/Cloudflare deployment order before handoff.

## Implementation evidence

- Removal history identified the regression: the former mailbox consume path
  disappeared while the conversation-lane replay-floor readers remained.
- A minimally directed ReviewGPT bug hunt independently recommended retaining
  `consumed_seq` and publishing the safe contiguous prefix at the existing idle
  snapshot checkpoint rather than at import time or through a new queue.
- The runtime now derives that prefix from the imported watermark and earliest
  still-pending hosted conversation input. Missing or malformed evidence fails
  closed, including across ordinary pending-index compaction.
- Web advances the prefix only after the `idle_shutdown` workspace CAS succeeds
  and in the same transaction; status-only checkpoints cannot consume it.
- Focused runtime and Web regressions cover mixed channels, retry gaps, replay-
  only repair, late inbound arrival, malformed/missing evidence, checkpoint
  conflict/rollback, and bounded wake inspection of large corrupt indexes.
- Compatibility is additive: deploy Web before the runner producer, use an
  immediate runner rollout, and roll back in reverse order. Neither skew
  direction can advance an unproven prefix.
- Focused verification is green: assistant-runtime handled-prefix tests
  (136/136), pending-index tests after the bounded-probe correction (23/23),
  Web checkpoint-store tests (51/51), assistant-runtime typecheck, and diff
  whitespace checks.
- The required coverage-write and product/reliability reviews both ended with
  no findings after their requested regression and bounded-I/O refinements.
- Canonical `test:diff` passed on the final synchronized patch: assistant-
  runtime (1,801 passed, 2 skipped), Cloudflare (1,856 passed), and Web's full
  test, typecheck, lint, and production-build verification.
