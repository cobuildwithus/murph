# Count fresh Web instance time in Linq typing alerts

Status: completed
Created: 2026-10-05
Updated: 2026-10-05

## Goal

- Make the warm typing alert measure what the member waited. Linq waits start at
  the provider's event, not at our route's `webhook_received_at`.
- Record enough route-start evidence to attribute time spent before the Linq
  webhook handler runs: process boot, lazy route load, or the platform.

## Evidence

- A warm typing alert (3797 ms) started at route receipt. Vercel request logs
  show the invocation began 3434 ms before the handler, on a new Fluid instance
  that had served nothing in the previous eight minutes. Vercel labeled it `hot`.
- Linq created the event 3486 ms before route start, so the member waited about
  7.3 s to typing. Runtime boot and the Linq typing call were normal.
- The rest of the excess was first-request process cost: the first Postgres
  connection, KMS auth, and slow first queries. Webhook-to-mailbox took 1827 ms
  against a warm p50 of 192 ms.
- Over seven days, 7 of 392 Linq message webhooks were the first request on a
  fresh process, waiting 1.4–3.4 s before the handler. The warm-process
  pre-handler gap is about 250 ms p50.
- 352 of 384 Linq traces over seven days have a recorded provider event for the
  exact mailbox message key.

## Success criteria

- Linq typing alerts measure from `LEAST(webhook_received_at, latest provider
  event created_at for the exact member-bound message)`, and fall back to receipt.
- A reply accepted in the same chat between that start and receipt restarts
  silence; the email names the provider event time when it moved the start.
- Telegram, edit, clock-skew, cross-member, and missing-event cases stay correct.
- The route timing log carries process uptime, route-module age, and request
  ordinal, and the pool-configured log carries process uptime.

## Scope

- In scope: the typing alert query and email, the Linq route timing details, the
  pool-configured diagnostic, focused tests, and the owner docs.
- Out of scope: reply-latency alerts, Telegram timing origin, KMS unwrap
  placement, and Vercel instance configuration.

## Constraints

- No schema migration; reuse `hosted_linq_provider_event` through its existing
  `(message_lookup_key, provider_created_at)` index.
- The start may only move earlier than receipt, never later.
- No member or message identifiers in logs or alert bodies.

## Risks and mitigations

1. Risk: an edited message inherits its original send time and pages falsely.
   Mitigation: use the latest event for the key, and test edits explicitly.
2. Risk: a provider clock running ahead shortens real waits.
   Mitigation: `LEAST` with receipt.
3. Risk: more alerts.
   Mitigation: a read-only replay of the last seven days of production gives
   19 alerts instead of 17, and the query time stays near 250 ms.

## Tasks

1. Add the provider-event origin to the alert query, the reset window, and the
   email.
2. Add the route-start and pool diagnostics.
3. Add focused PostgreSQL and route tests, and update RELIABILITY and the Web README.

## Decisions

- Boot-time connection warmup in `instrumentation.ts` was considered and
  deferred, for three reasons:
  - On Vercel, Next runs in minimal mode, so route modules load on the first
    request, not at server start.
  - Instrumentation compiles into a separate webpack layer, so a warmed client
    would need a process-global Prisma client and a duplicate Prisma module
    evaluation on boot.
  - The local route-module load is about 0.2 s, which suggests most of the 3.4 s
    happens before our process runs.

  The new diagnostics decide whether warmup has a window to use.
- Starting the Temporal connection early was rejected, because the direct wake
  starts as soon as `signalWithStart` is invoked and never waits for it.

## Verification

- Commands to run:
  - Typing-alert PostgreSQL proof (`MURPH_TEST_POSTGRES_CONCURRENCY=1`).
  - Linq route, Prisma, alert email, alert cron, and internal-route Vitest files.
  - Web typecheck, `pnpm complexity:diff`, `pnpm docs:drift`, and `pnpm docs:gardening`.
- Expected outcomes: all pass. The new provider-origin test fails on the old
  query and passes on the new one.
Completed: 2026-10-05
