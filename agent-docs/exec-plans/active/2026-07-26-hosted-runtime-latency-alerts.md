# Hosted runtime latency alerts

Status: active
Created: 2026-07-26
Updated: 2026-07-27

## Goal

- Detect reply-latency incidents from Murph's existing production latency facts
  every five minutes and send a low-volume operational text to one configured,
  pre-established Linq chat.
- Make the hosted-local foreground-priority gate enforce the same 30-second
  user-visible latency boundary used by the production monitor.

## Success criteria

- A Vercel-authenticated cron runs every five minutes without becoming a runtime
  work owner.
- A Linq ingress is anomalous when its accepted outbound reply takes at least
  30 seconds, or when it is at least 30 seconds old and still has neither an
  accepted delivery nor durable consumed evidence.
- One durable operational-alert row deduplicates concurrent scans, retries an
  ambiguous send with Linq idempotency, silently clears after a healthy scan,
  and gives a later incident a new alert identity.
- Alert text contains aggregate timing/count evidence only: no message content,
  member identifiers, phone numbers, chat IDs, or trace IDs.
- Missing alert-chat configuration disables outbound alerting without weakening
  reply processing or runtime reconciliation.
- Focused route, detector, incident-state, retry, concurrency, and copy tests
  pass; the hosted-local foreground-priority scenario passes with a 30-second
  reply deadline and exercises real cron, PostgreSQL, and Linq alert egress.

## Scope

- In scope:
  - `apps/web` latency query, alert state machine, Linq send, cron route, env
    documentation, Vercel schedule, and approved-cron guard.
  - Focused Web tests for anomaly classification and exactly-once incident
    behavior.
  - The existing hosted-local foreground-priority E2E deadline and its CI/docs
    description.
- Out of scope:
  - A second Temporal workflow, Cloudflare alarm, scheduler, queue, or synthetic
    production message.
  - Runtime wake, mailbox, checkpoint, or reply-delivery behavior changes.
  - Starting a new Linq conversation or persisting a personal phone number.

## Constraints

- Technical constraints:
  - `apps/web` remains the latency-fact and operational-alert owner.
  - Reuse `HostedLinqAlert` for one PII-free monitor-state row; do not add a
    schema migration or second state service.
  - Use an existing Linq chat ID from server-only environment and the existing
    idempotent Linq send wrapper.
  - Completed latency uses ingress `acceptedAt` to provider-accepted delivery;
    pending latency requires both missing accepted delivery and missing
    `HostedMailboxItem.consumedAt`.
- Product/process constraints:
  - The 30-second boundary is fixed in code and tests rather than operator
    configurable.
  - Operational alert copy is concise and reciprocal-conversation-safe.
  - The final PR uses the repository's preliminary specialist and final
    ReviewGPT gates.

## Risks and mitigations

1. Risk: best-effort trace linkage can look like a missing reply.
   Mitigation: page for an unresolved trace only when accepted delivery and
   durable consumed evidence are both absent.
2. Risk: overlapping or retried cron invocations could text repeatedly.
   Mitigation: claim one singleton state row with status compare-and-set and use
   a stable Linq idempotency key per incident.
3. Risk: alerting failure could affect the user reply path.
   Mitigation: the cron is the only caller; no ingress, Temporal, Cloudflare, or
   runtime path awaits the monitor.
4. Risk: a one-way operational thread can lose provider deliverability.
   Mitigation: require a pre-established dedicated chat and document one-time
   human reply/periodic line-health verification.

## Tasks

1. Add a bounded latency-health query over existing ingress, delivery, and
   consumed facts.
2. Add the isolated alert state machine and Linq transport.
3. Add the authenticated five-minute cron and server-only configuration.
4. Lower the hosted-local foreground priority deadline to 30 seconds.
5. Add focused tests and update current runtime/testing documentation.
6. Run required verification and repository review gates, then publish the PR.

## Decisions

- Treat exactly 30,000 milliseconds as anomalous (`>= 30_000`).
- A healthy scan silently clears the incident so aged observability data cannot
  produce a misleading operator recovery text.
- Reuse the existing operational alert table rather than adding state.
- Keep the alert destination as an opaque existing-chat ID; do not resolve or
  store a phone number in the monitor.

## Verification

- Commands to run:
  - Focused Vitest files for latency health, monitor state, and cron auth.
  - `pnpm test:diff ...`
  - Direct hosted-local `foreground-reply-priority` scenario.
  - `pnpm verify:acceptance`
  - Preliminary `completion-specialists` ReviewGPT, product-experience review,
    and final PR ReviewGPT while CI runs.
- Expected outcomes:
  - Detector and state-machine edge cases pass.
  - All four real hosted-local contention cases reply once within 30 seconds.
  - Required repository checks and PR CI are green.
- Results so far:
  - The focused Web monitor/cron/approved-cron suite passed 47 tests.
  - The post-review hosted-local run passed all five cases. Measured reply
    latencies were 13.134 seconds (system mailbox), 8.549 seconds (retention),
    7.997 seconds (stale invocation), and 11.960 seconds (active turn), all
    below the fixed 30-second deadline. The fifth case proved alert send,
    lost-ack retry with the same body and idempotency key, coalescing, silent
    healthy clear, a new alert identity on recurrence, and the absence of
    seeded customer/trace identifiers and message content from real alert
    egress.
  - Canonical `pnpm test:diff ...` passed in one fresh Crabbox/Blacksmith
    Testbox: 532 Web test files and 6,753 Web tests passed, with Cloudflare
    verification, lint, typecheck, and build also green.
  - Product-experience review returned no findings after recovery texts were
    removed and the real cron/PostgreSQL/Linq proof was added.
  - Preliminary ReviewGPT findings were resolved with a fresh-send lease guard,
    a deferred overlapping-cron/exact-expiry test, real-egress privacy
    assertions, and an exact five-minute schedule guard. The post-remediation
    focused suite passed 48 tests.
