# Hosted Ingress Latency Dashboard

Status: reviewed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

Add a hidden ops dashboard that shows production latency from durable hosted
message acceptance to provider-request start, starting with Linq replies.

The implementation should answer the immediate question: "Are hosted Linq
messages reaching provider generation in under the target latency budget, and
where do slow messages spend time?"

## Subagent Review Fixes Incorporated

- Use a dedicated provider-request-start observer instead of repurposing
  pre-provider diagnostic traces.
- Keep raw correlation ids out of hosted runtime logs and dashboard output.
- Scope every callback write by the signed authenticated hosted member id.
- Make milestone updates first-observed wins so retries and out-of-order
  callbacks do not corrupt percentiles.
- Report dashboard completeness denominators so missing callbacks and in-flight
  rows are visible instead of hidden by completed-row percentiles.

## Success Criteria

- The dashboard reports p50, p95, p99, count, missing-provider-start count, and
  recent slow traces for `linq_accept_to_provider_start_ms`.
- The metric is named honestly as provider-start latency, not first-token or
  OpenAI-stream latency.
- `providerStartAt` comes only from a dedicated provider-request-start boundary
  emitted immediately before a provider attempt starts, not from existing
  pre-provider diagnostic timing.
- The stored data is metadata-only: no raw message text, provider payloads,
  prompts, transcripts, contact addresses, headers, secrets, provider responses,
  local paths, or raw webhook bodies.
- Raw mailbox item ids, assistant input ids, runtime attempt ids, and other
  stable internal correlation ids are stored server-side only; they are not
  rendered in the dashboard or written into hosted runtime logs.
- The primitive is reusable for future hosted ingress sources without becoming
  a generic JSON event table.
- Runtime timing writes are best-effort and must never block webhook response,
  Temporal signaling, mailbox import, assistant staging, provider start, or
  outbound delivery.
- Focused tests and required repo verification pass, or unrelated blockers are
  recorded with exact commands and failing targets.

## Primitive Decision

Use one typed Postgres row per externally accepted hosted inbound message that
may trigger an assistant/provider reply:

`HostedIngressLatencyTrace`

This is intentionally **source-generic but lifecycle-specific**. It is not a
Linq-only table, and it is not a generic observability/event bucket.

The durable lifecycle milestones are fixed columns because the important
questions are fixed and operational:

- accepted by web and committed to hosted mailbox
- Temporal runtime signal sent
- assistant input staged inside the restored runtime
- provider request started

This keeps query semantics obvious, indexed, typeable, and privacy-reviewable.
If a future need appears for many dynamic spans, add a separate stage table then;
do not start there.

## State Classification

- Owner: `apps/web` Postgres.
- State class: hosted operational/control-plane metric, not canonical health
  truth and not assistant runtime state.
- Reasoning: the value is queryable operational product state for hosted
  reliability. It belongs with other hosted control facts in web-owned
  Postgres, not in Cloudflare Durable Object state, Temporal workflow state, or
  encrypted assistant runtime residue.

## Data Model

Add a typed Prisma model similar to:

```prisma
model HostedIngressLatencyTrace {
  id                     String            @id
  userId                 String            @map("user_id")
  source                 String
  mailboxItemId          String            @unique @map("mailbox_item_id")
  mailboxLane            String            @map("mailbox_lane")
  mailboxLaneSeq         BigInt            @map("mailbox_lane_seq")
  assistantInputId       String?           @map("assistant_input_id")
  runtimeAttemptId       String?           @map("runtime_attempt_id")
  acceptedAt             DateTime          @map("accepted_at")
  temporalSignalAcceptedAt DateTime?       @map("temporal_signal_accepted_at")
  assistantInputStagedAt DateTime?         @map("assistant_input_staged_at")
  providerStartAt        DateTime?         @map("provider_start_at")
  providerRequestOrdinal Int?              @map("provider_request_ordinal")
  createdAt              DateTime          @default(now()) @map("created_at")
  updatedAt              DateTime          @updatedAt @map("updated_at")

  member                 HostedMember      @relation(fields: [userId], references: [id], onDelete: Cascade)
  mailboxItem            HostedMailboxItem @relation(fields: [mailboxItemId], references: [id], onDelete: Cascade)

  @@index([source, acceptedAt])
  @@index([source, providerStartAt])
  @@index([userId, acceptedAt])
  @@index([assistantInputId])
  @@index([runtimeAttemptId])
  @@map("hosted_ingress_latency_trace")
}
```

Notes:

- Keep the DB column as text, but expose a shared
  `HostedIngressLatencySource` literal parser starting with `linq`. Add future
  source values intentionally as each hosted ingress source is wired.
- Keep `userId` for deletion/export/account scoping, but do not render it on
  the dashboard.
- Use `HostedMailboxItem.createdAt` as the durable accepted timestamp.
- Do not store raw payload fields or any body/header/contact detail.
- Retention follows the mailbox row: deleting/retaining hosted mailbox rows
  should cascade trace rows. Account deletion must count/delete the rows
  explicitly, and account export should expose only aggregate metadata/counts
  unless a deliberate user-facing row export is later designed.

## Write Semantics

- The signed callback route must not accept `userId` in the body. It passes the
  authenticated hosted member id from `requireHostedCloudflareCallbackRequest`
  into the store.
- Every trace update filters or joins by the authenticated member id plus the
  trace key. Cross-member mailbox item or assistant input mismatches fail closed
  with bounded metadata only.
- Accepted fields are immutable once hydrated from `HostedMailboxItem`.
- Milestone timestamps are first-observed wins: set when null, or keep the
  earlier timestamp if duplicate/retry callbacks arrive out of order.
- `recordHostedIngressAssistantInputStaged` must upsert from `mailboxItemId` by
  reading `HostedMailboxItem.createdAt`, lane, lane seq, and owner. This lets a
  later staging event recover when the initial accepted write was missed.
- `provider_started` updates all rows matching the authenticated member and the
  accepted assistant input ids. Duplicate provider-start callbacks preserve the
  earliest provider-start timestamp and bounded-conflict log only counts, not
  raw ids.
- Unmatched provider-start assistant input ids are returned as counts from the
  store/route and logged as safe coverage-loss metadata. Do not add a second
  generic telemetry table just for unmatched ids.

## Dashboard Aggregation Semantics

- Aggregate over an accepted-at window, not a provider-start window, so missing
  traces remain visible.
- Percentiles use completed rows with non-null, non-negative
  `providerStartAt - acceptedAt` only.
- Also return total accepted count, completed count, missing-staged count,
  staged-but-missing-provider count, recent in-flight count, and
  invalid-negative-latency count.
- Exclude very recent rows from true "missing provider start" or label them as
  in-flight so the dashboard does not confuse live work with stuck work.
- If no completed rows exist, show empty percentile values plus the denominator
  counts rather than rendering zero.
- Recent slow rows must not render stable/dereferenceable identifiers such as
  user id, mailbox item id, assistant input id, runtime attempt id, trace id,
  lane seq, or provider request id. Prefer aggregate/stage timing rows and
  non-identifier row labels.

## Implementation Plan

1. Add the Prisma model and migration.
   - Add relations on `HostedMember` and `HostedMailboxItem`.
   - Create the SQL migration under `apps/web/prisma/migrations/**`.
   - Preserve cascade deletion, but also update account deletion/export code so
     privacy behavior is explicit.

2. Add a small web-owned latency store.
   - New module: `apps/web/src/lib/hosted-runtime-latency/store.ts`.
   - Expose typed functions:
     - `recordHostedIngressAcceptedFromMailboxItem`
     - `recordHostedIngressTemporalSignalAccepted`
     - `recordHostedIngressAssistantInputStaged`
     - `recordHostedIngressProviderStarted`
     - `readHostedIngressLatencyDashboard`
   - Use Prisma queries and SQL percentile aggregation for dashboard reads.
   - Keep write functions idempotent, owner-scoped, and first-observed wins.
   - Return matched/unmatched counts for provider-start writes without storing
     raw unmatched ids.

3. Record web-local milestones.
   - In hosted onboarding Linq handoff, record accepted after the mailbox item
     exists.
   - Record Temporal signal acceptance after a successful signal call.
   - Timing write failure should only emit safe, fixed-shape metadata and must
     not fail provider webhook handling.

4. Add a narrow signed runtime callback route.
   - New route: `apps/web/app/api/internal/hosted-runtime/latency/route.ts`.
   - Use the existing hosted Cloudflare callback auth helper.
   - Pass the authenticated member id into the store; never trust or accept a
     member/user id from the JSON body.
   - Accept only typed events for:
     - `assistant_input_staged`
     - `provider_started`
   - Use exact-key parsing, a small body limit, bounded arrays, and reject
     unknown keys. Explicitly reject raw prompt, messages, payload, headers, raw
     body, and arbitrary JSON fields.

5. Add shared hosted-execution contract support.
   - Add `HOSTED_RUNTIME_LATENCY_TRACE_PATH`.
   - Add request/response parsers for the two runtime event variants.
   - Keep the event contract metadata-only and bounded.
   - Use the shared `HostedIngressLatencySource` parser for source fields.

6. Add a hosted runtime platform port.
   - Add optional `latencyTracePort` to `HostedRuntimePlatform`.
   - Wire Cloudflare's runtime platform to POST to the new web route.
   - Add the new internal path to the web-control outbound allowlist.
   - Use a short timeout. Treat 404, 401, 5xx, parser failures, invalid JSON,
     and timeout as swallowed telemetry failures with bounded metadata only.
     Never retry synchronously on the hot path.

7. Record assistant-input staging.
   - Thread the runtime attempt id into hosted mailbox conversation import.
   - When a mailbox item becomes an `AssistantInputEvent`, call the latency
     port with source, mailbox item id, assistant input id, and staged time.
   - Fire-and-forget the latency write with a short timeout and swallowed
     fixed-shape failure. Do not block staging or assistant execution.
   - This is the only point where raw mailbox item id and assistant input id
     naturally coexist, so capture correlation there.

8. Record provider-start.
   - Add a dedicated provider-request-start observer at the assistant-engine
     boundary immediately before the provider attempt/request starts.
   - The hosted runtime passes a callback that sends:
     `{ assistantInputIds, runtimeAttemptId, providerRequestOrdinal, startedAt }`.
   - Update all matching trace rows by authenticated member id and
     `assistantInputId`, preserving the earliest provider start on retries.
   - Keep raw assistant input ids confined to this signed latency callback/store
     path. Existing hosted runtime logs and assistant diagnostic traces may
     include counts, stage names, ordinals, and timings, but not raw assistant
     input ids.
   - Do not rely on persisted `HostedRuntimeLog.redactedJson` as the metric
     source. The new table is the source of truth.

9. Add the hidden ops dashboard.
   - New page: `apps/web/app/(dashboard)/ops/runtime-latency/page.tsx`.
   - Do not add public navigation yet.
   - Gate with a server-only `requireHostedOpsAccess` helper: active hosted
     session required, deny-by-default ops allowlist env, no client-side access
     decision, dynamic/no-store rendering, and noindex metadata.
   - Bound `source`, time-window, and `limit` search params with safe defaults
     and maximums.
   - Render aggregate latency, stage breakdown, and recent slow traces without
     stable internal ids, user ids, contacts, message text, prompts, or payload
     excerpts.

10. Add focused tests.
    - Store aggregation and idempotent updates.
    - Duplicate, out-of-order, cross-member mismatch, missed accepted-write, and
      multi-input provider-start cases.
    - Internal route parser/auth behavior.
    - Exact-key parser rejection for unknown/raw-content fields.
    - Linq accepted/signaled best-effort writes.
    - Hosted-execution parser contract.
    - Assistant-engine provider-start observer at the actual provider boundary.
    - Hosted runtime provider-start forwarding without raw ids in runtime logs.
    - Cloudflare latency port timeout/skew behavior and outbound allowlist.
    - Dashboard auth/search-param/query rendering, including empty completed
      rows, partial traces, and negative-latency handling.

11. Verify and review.
    - Run focused package/app tests while iterating.
    - Run the required typecheck and truthful diff/owner verification.
    - Because this touches persisted state, observability, internal routes,
      Cloudflare runtime callbacks, and user-facing web UI, run the required
      security/privacy, coverage, frontend, simplification-if-large, and final
      review passes before handoff.

## Non-Goals

- Do not build a generic span/event telemetry platform.
- Do not use runtime logs as the dashboard's metric source of truth.
- Do not measure OpenAI first token in this slice; provider-start is enough to
  locate the current hosted reply latency failure.
- Do not reuse `assistant-pre-provider-ready` as provider start.
- Do not expose the dashboard in primary navigation before the operator surface
  and access policy are proven.
- Do not add another scheduler, queue, or reconciler for timing writes.

## Likely Working Set

- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/**`
- `apps/web/src/lib/hosted-runtime-latency/**`
- `apps/web/app/api/internal/hosted-runtime/latency/route.ts`
- `apps/web/app/(dashboard)/ops/runtime-latency/page.tsx`
- `apps/web/src/lib/hosted-runtime-latency/ops-auth.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service-wake.ts`
- `apps/web/src/lib/hosted-privacy/account-data-service.ts`
- `packages/hosted-execution/src/routes.ts`
- `packages/hosted-execution/src/parsers/**`
- `packages/assistant-runtime/src/hosted-runtime/platform.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- `packages/assistant-engine/src/assistant/hosted-context-diagnostics.ts`
- `packages/assistant-engine/src/assistant/local-service.ts`
- `packages/assistant-engine/src/assistant/**` provider-request-start hook surface
- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/src/runner-outbound/shared-web-control-policy.ts`
- Focused tests beside the touched owners.

## Verification Plan

- Direct readback of this plan after creation.
- For implementation:
  - `pnpm typecheck`
  - `pnpm test:diff <touched paths>` when truthful
  - package/app focused tests for web, Cloudflare, assistant runtime, assistant
    engine, and hosted-execution as needed
  - direct dashboard/browser proof after the page exists
  - `git diff --check`

## Deployment Concerns

The runtime callback contract and web route must deploy compatibly. Prefer this
order:

1. Deploy web with the new Prisma migration, route, parser, store, and dashboard.
2. Deploy Cloudflare/runtime code that begins sending latency trace callbacks.

Cloudflare should treat a missing or failing latency route as best-effort, so
deploy skew must not break hosted replies.
