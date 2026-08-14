# Coalesce device webhooks before Postgres admission

Status: completed
Created: 2026-08-13
Updated: 2026-08-14

## Goal

- Accept bursty wearable-provider webhooks durably before Postgres, coalesce them into bounded batches, and reduce peak pooled database checkout demand by roughly two orders of magnitude while preserving exact event work, level-hint semantics, consent, provider application, source, connection-epoch, reconnect, and disconnect authority.

## Success criteria

- A maximum Cloudflare consumer batch of 100 provider deliveries reaches Web through at most four size-bounded signed subbatches and at most one concurrent pooled database admission.
- Duplicate and at-least-once deliveries are idempotent; level hints coalesce while exact durable webhook work remains lossless and explicitly acknowledged.
- Withdrawal, disconnect/reconnect, source lifecycle, setup, and private-application races fail closed at final Web-owned admission.
- Provider receives success only after the encrypted/allowlisted ingress envelope is durably accepted; retry and dead-letter behavior has a finite recovery owner.
- The design composes with PRs #1736 and #1696 and absorbs PR #1743's final outside-transaction crypto work so the queue path has one deployable admission boundary.
- Focused deterministic load/privacy/race tests, typechecks, ReviewGPT specialist/final gates, and required PR CI pass.

## Scope

- In scope: provider webhook POST ingestion, external verification and envelope minimization/encryption, Cloudflare queue/batch configuration, Web batch authority/persistence, idempotency, backpressure, DLQ/operator recovery, deployment compatibility, and load proof.
- Out of scope: OAuth callbacks, browser/companion admissions, canonical vault writes, provider reconcile policy, changing downstream Temporal/runner ownership, or raising database capacity.

## Constraints

- Technical constraints: Web remains canonical device-sync control plane; Cloudflare owns only durable ingress transport; raw health/provider bodies and tokens cannot become Cloudflare product truth; all final mutable authority is revalidated in short database-only transactions; no per-message concurrent transaction fanout.
- Product/process constraints: no user-visible sync regression, no copied private incident/member evidence, and no new provider-facing contract without reader/producer rollout and rollback proof.

## Risks and mitigations

1. Risk: queue acceptance weakens consent/reconnect authority or acknowledges work that later becomes stale.
   Mitigation: separate durable transport acceptance from final Web admission and bind envelopes to stable provider trace/account facts; accept canonical no-op outcomes only after the existing trace owner records them, and retain every failed admission for encrypted DLQ recovery.
2. Risk: batching merely moves 100 independent transactions into one consumer invocation.
   Mitigation: keep consumer concurrency at one, partition callbacks at 25 items, and require deterministic 100-item peak-one admission tests. The current Prisma adapter cannot lease one session across independent transactions, so this change reduces peak concurrent checkouts rather than introducing a parallel raw-SQL persistence owner.
3. Risk: raw health payloads live in an external queue or DLQ.
   Mitigation: minimize and seal before enqueue, bound size/retention, and keep DLQ data encrypted and operator-inspectable only as metadata.
4. Risk: deployment skew loses or double-processes webhooks.
   Mitigation: use additive endpoints/bindings, idempotent envelopes, a reader-first sequence, live queue-depth/DLQ proof, and an explicit rollback floor.

## Tasks

1. [x] Map current per-webhook database/crypto/wake boundaries and inspect #1736, #1696, and #1743.
2. [x] Have ReviewGPT research official Queue, Durable Object, Workflow, and Temporal semantics; select the smallest current primitive and return an implementation patch.
3. [x] Inspect and integrate the patch, proving privacy, authority, event-vs-level semantics, 100-message batch load, retry, and deploy skew.
4. [x] Push the exact candidate, run specialist and final ReviewGPT gates with CI, and complete the PR handoff.

## Decisions

- Existing Postgres `device_sync_dirty_connection` remains the downstream coalescing/product-control owner; the new store may own only accepted transport envelopes awaiting batch admission.
- ReviewGPT selected Cloudflare Queues as encrypted, non-canonical burst transport. Postgres remains the only device-sync authority; Durable Objects, Workflows, Temporal ingress state, a second database, and raw-body Postgres staging were rejected as unnecessary owners.
- Provider verification and parsing run once before enqueue because Junction, Oura, Strava, and WHOOP enforce replay windows. Queue replay consumes only the strict prepared meaning and never reruns a provider verifier; the original receipt instant remains immutable evidence while all mutable provider registration, consent, application, connection, and source authority is revalidated at dequeue.
- Delayed Junction source-registration work uses the existing health-data admission owner on both sides of its provider status read. The first short transaction establishes current authority and an exact ephemeral source/account proof, the provider read runs outside Postgres, and the second short transaction revalidates that proof before source activation and canonical webhook admission commit together. Terminal authority loss completes only the trace; indeterminate provider/account state remains retryable.
- PR #1743's prepared dirty-payload and mailbox crypto boundary is merged into this candidate. Payload classification, root unwrap, and provider reads occur before the final transaction; the final lock only revalidates roots/authority, performs local sealing, and commits receipt, source, trace, dirty, mailbox, and signal state atomically.

## Verification

- Commands to run: focused shared ingress, Web device-sync store/wake/route, Cloudflare ingress/queue, configuration, privacy, and real-Postgres race/load suites; affected package typechecks; `git diff --check`; required exact-head CI.
- Expected outcomes: 100 deliveries produce peak-one Web admission pressure, duplicates remain harmless, exact payloads survive retries, stale epochs/withdrawn consent never import, and queue/DLQ state contains no plaintext health or credentials.
Completed: 2026-08-14
