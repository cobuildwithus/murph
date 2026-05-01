# Require hosted webhook runner nudge acceptance

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Make hosted Linq/Telegram active-member webhooks return success only after
  Cloudflare accepts the per-user runner nudge, relying on the messaging
  provider webhook retry as the durable retry owner instead of adding a new web
  datastore or managed workflow.

## Success criteria

- Active-member webhook handling still appends the canonical mailbox event
  transactionally.
- The Cloudflare runner nudge is awaited inline with a short timeout and throws
  if unconfigured, failed, or not accepted.
- Deferred `after()` wake handoff is removed from the Linq and Telegram webhook
  hot path.
- Focused hosted onboarding webhook/wake tests cover success and retryable
  nudge failure behavior.

## Scope

- In scope: `apps/web` hosted onboarding webhook wake control and directly
  coupled tests.
- Out of scope: Cloudflare Durable Object scheduling, Cloudflare Queues,
  Vercel Workflows, new persisted stores, provider webhook parsing, billing or
  device-sync wakes.

## Constraints

- Technical constraints: preserve idempotent mailbox append semantics; avoid
  logging plaintext provider payloads, messages, secrets, or local paths; keep
  the Cloudflare nudge a small control-plane call rather than waiting for the
  runner/container invocation.
- Product/process constraints: preserve unrelated dirty work in the checkout
  and keep the fix narrow.

## Risks and mitigations

1. Risk: provider webhook response latency increases by the Cloudflare control
   call duration.
   Mitigation: use a short webhook-specific timeout and keep the nudge call
   limited to Durable Object acceptance.
2. Risk: a transient Cloudflare/control-plane failure now returns non-2xx.
   Mitigation: mailbox append is idempotent, duplicate nudges are harmless, and
   provider retry becomes the retry owner.

## Tasks

1. Inspect current webhook wake/control and focused tests. Done.
2. Patch the wake handoff to require inline short-timeout nudge acceptance.
   Done.
3. Update focused tests for inline success/failure behavior. Done.
4. Run focused verification, required audits, and scoped commit flow. Done,
   with broad typecheck blocked by unrelated active device-sync provider edits.

## Decisions

- Do not add Vercel Workflows or a custom outbox for this pass. The simplest
  durable retry path is provider retry after non-2xx, backed by idempotent
  mailbox append and idempotent runner nudges.
- Public webhook errors for runner-nudge failure use one generic retryable 503
  code/message. Internal nudge details stay in sanitized timing fields.

## Verification

- Passed: focused hosted onboarding webhook/wake Vitest command
  (`6` files, `58` tests), `pnpm --dir apps/web lint` with unrelated warnings
  only, `pnpm docs:drift`, and `git diff --check`.
- Blocked by unrelated active work after the first green run:
  `pnpm --dir apps/web typecheck` and scoped `workspace-verify test:diff`
  fail on device-sync provider/OAuth type drift outside this task.
- Required audits: security/privacy found and parent fixed the public error
  leakage; coverage-write added the unconfigured nudge proof; final review
  found no issues in scope.
Completed: 2026-05-01
