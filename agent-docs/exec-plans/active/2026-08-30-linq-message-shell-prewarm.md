# Early Linq message shell prewarm

Status: active
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Start the existing payloadless Cloudflare shell prewarm as soon as an
  direct Linq message resolves an active hosted member,
  before the mailbox planning transaction and Temporal signal complete.
- Preserve the ordinary post-Temporal direct ensure as the only foreground
  processing owner.
- Carry enough request-to-container timing through the existing prewarm
  observation to measure Durable Object activation, admission, and useful
  overlap without a second telemetry store.

## Protected invariants

- The early hint creates no mailbox, write fence, workspace invocation,
  processing authority, retry owner, queue, scheduler, or persisted state.
- Web eligibility remains advisory. Cloudflare rechecks live Web-owned
  health-data admission under the existing per-user consent-mutation barrier.
- A failed, skipped, stale, duplicate, or evicted prewarm never blocks webhook
  planning, provider acknowledgement, Temporal signaling, or direct ensure.
- Prewarm telemetry remains metadata-only, bounded, and diagnostics-only.

## Evidence

- The latest direct cold trace spent 429 ms between durable mailbox acceptance
  and Temporal acknowledgement, then 1,384 ms between the Cloudflare route and
  UserRunner constructor start. No shell-prewarm observation was present.
- `warmHostedLinqMailboxPayloadRoot` already resolves only active members with
  usable crypto roots before KMS work and before the planning transaction.
- `prewarmRuntimeShellForUser` already performs the live Cloudflare admission
  recheck, reserves the exact container target, and issues only the platform
  start hint. RunnerContainer already coalesces repeated hints.

## Scope

- In scope: established direct Linq message routing, existing shell-prewarm contracts,
  request/activation/admission timing carried by the existing observation,
  identifier-free cold-start reporting, focused tests, and matching durable
  runtime/security/deployment documentation.
- Out of scope: starting real processing before Temporal, keepalive alarms,
  another queue or scheduler, container image changes, idle-lifetime changes,
  database schema changes, and production deployment.

## Tasks

1. Add one early eligible-message caller to the existing shell-prewarm path and
   thread its attempt identity explicitly into the committed wake handoff.
2. Extend the existing prewarm observation with bounded Web request,
   Cloudflare route, UserRunner activation/RPC, and admission timestamps.
3. Update the identifier-free report and focused unit/E2E contracts so only an
   exactly matched message-routing hint is classified as causal.
4. Run focused tests, affected package builds/typechecks, diff checks, and the
   required exact-head ReviewGPT plus CI workflow.

## Deployment concerns

- Web must deploy first because it accepts legacy Cloudflare prewarm responses
  and sends only additive request fields/source values. Cloudflare then deploys
  the additive source and timing writer. Old Web ignores the new diagnostics;
  new Web treats missing diagnostics as an ordinary optional prewarm.
- Rollback remains safe while the new source is accepted by every live
  Cloudflare route. Revert the early Web producer before rolling Cloudflare
  below support for the new source.

## Progress

- Root cause and earliest safe eligibility boundary are confirmed from the
  production trace and current Web/Cloudflare owners.
- The direct-route hint starts as soon as the existing active-member access
  read resolves, while sibling routing reads continue in parallel. Established
  group/thread routing does not invoke the optimization. No path adds a query.
- One request-local correlation ID follows the existing Web client, Worker
  route, UserRunner activation/admission, and first RunnerContainer hint. The
  final wake expects that exact ID, so the report attributes overlap only when
  the consumed observation matches it.
- Product UX Patch:
  - Outcome: established members can spend less time waiting for the first
    reply after Murph has been idle.
  - Reaches: ordinary direct Linq messages that need a cold hosted runtime.
  - Proof: focused routing tests show the best-effort hint starts before KMS
    work and the direct ensure remains after Temporal acceptance; the signed
    hosted-local journey and exact-ID report contracts tie that hint to the
    delivered reply without exposing member identifiers.
- Product UX walkthrough: `Ready`. The ordinary message journey and its final
  destination are unchanged; only best-effort shell startup moves earlier.
  Ineligible, failed, duplicate, or skipped hints preserve the existing safe
  path and never delay durable acceptance or processing.
- Review follow-up keeps the producer direct-only, records auth timing on the
  signed shell-prewarm route, and suppresses the message-routing callback on
  post-enrollment instant-start replans. Tests prove the instant-start wake has
  no message-routing attempt identity.
- Focused Cloudflare control/report and hosted Web routing/mailbox suites pass
  (120, 210, and 24 tests respectively), as do both affected typechecks,
  focused Web lint, the Cloudflare build exercised by hosted-local preparation,
  and `git diff --check`.
- The opt-in PostgreSQL report fixture passes against a disposable loopback
  PostgreSQL instance, including exact-match and mismatch message-routing rows.
  The composed hosted-local scenario is checked in but could not start locally
  because this checkout has no external Temporal worker package configured; CI
  owns that provisioned run.
