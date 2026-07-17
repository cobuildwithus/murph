# Reliability

Last verified: 2026-07-16

## Current Guardrails

- Keep behavior deterministic and documented as the first modules are added.
- Prefer explicit failure paths and actionable errors over silent fallback behavior.
- Update architecture and verification docs in the same change that introduces new runtime entrypoints.
- Avoid hidden coupling between scripts, docs, and runtime code; document new dependencies in `ARCHITECTURE.md` and `agent-docs/references/testing-ci-map.md`.
- Use the concrete runtime contracts first: hosted runner wake/checkpoint behavior lives in `agent-docs/references/hosted-runtime-protocol.md` plus `apps/cloudflare/README.md`; deploy recovery and smoke expectations live in `apps/cloudflare/DEPLOY.md`; local device-sync and assistant daemon retry/control-plane behavior live in their package READMEs and tests.

## Runtime Expectations

- Define startup requirements, health checks, and critical invariants.
- Document retry/idempotency expectations for writes or background work.
- Add tests for failure modes before relying on production-side recovery logic.
- Foreground inbox/parser-backed daemon runs should favor restartable connectors with bounded backoff over permanently dead watch loops, while still keeping low-level restart behavior opt-in and always bounded by the owning abort signal.
- Networked assistant/provider/channel calls should set explicit timeouts, propagate caller abort signals, and only auto-retry request shapes that are replay-safe or rate-limit directed.
- Hosted managed-automation reconciliation persists retry generation in the existing workspace checkpoint owner. Only eligible, explicitly retryable failures receive the bounded 30-second, 2-minute, and 10-minute backoff sequence; unclassified or permanent failures are logged without manufacturing another wake, and a later successful pass clears the retry generation.
- A usage-credit purchase persists one reconstructible `created` purchase before
  Stripe I/O; that row and the single purchase-status lifecycle are the durable
  ambiguity fence. Every create retry during the first 30 minutes uses the
  same purchase-derived Stripe idempotency key, leaving at least 60 minutes on
  the frozen Session expiry. An ambiguous response must
  not mint a replacement purchase or create a second payable Session. The
  member may begin another purchase only after the existing one is terminal.
- Usage-credit fulfillment reuses the Stripe event receipt as its retry owner.
  It verifies live one-time payment state, then appends the unique grant and
  updates the beneficiary balance/version projection in one locked
  transaction. Included allowance is consumed first; credit debits serialize
  under the same beneficiary owner and crossing overage is absorbed rather than
  becoming debt. A committed grant clears the current usage block when capacity
  becomes positive and makes the normal runtime recheck a retry-owned
  post-commit obligation, so accepted blocked input remains pending and can
  resume. Duplicate Checkout and webhook delivery must converge on the same
  purchase, grant, and recheck outcome. Provider/KMS preparation and the full
  database-plus-Temporal recheck handoff are hard-bounded below the derived
  receipt lease, and receipt completion must win its exact attempt fence; a
  timed-out or reclaimed worker remains retryable and cannot report completion.
- Matching usage-credit refund or dispute events must never fall through to the
  subscription suspension path. Live re-fetch plus the same beneficiary lock
  must append replay-safe, capped signed `refund_adjustment` or
  `dispute_adjustment` entries as live financial exposure moves. Negative
  entries revoke unused credit and positive entries restore only credit that
  was previously revoked. A failure keeps the Stripe receipt retryable; it does
  not silently complete the event.
- Read-only Labs discovery has no automatic provider retry, background refresh, or stale cache fallback. Web applies explicit time, response-byte, result-count, and location-fanout bounds and propagates caller cancellation. A Junction timeout, rate limit, or server failure is `temporarily_unavailable`; it must not be collapsed into an empty catalog or `not_served`. Only a clean provider response that reports no ZIP coverage is `not_served`.
- Labs capability rollout is additive and fail-closed. Deploy Web's signed callback and provider configuration before Cloudflare/runtime registration; a missing or incompatible route surfaces as unavailable rather than falling back to a copied catalog. Roll back the runtime capability before removing the Web route. Because the feature has no DB, cache, queue, or retry owner, recovery is a later member-initiated live request.
- Definite assistant outbox delivery failures may run at most 48 persisted dispatch attempts. A definite failure on attempt 48 terminalizes as `ASSISTANT_DELIVERY_RETRY_EXHAUSTED`, and no 49th provider call begins; newsletter parent and recipient replay must preserve that logical terminal state instead of resetting the budget with a new token. A delivery that may already have succeeded is not exhausted as an ordinary failure: hosted non-idempotent confirmation remains parked without an automatic wake, while replay-safe delivery checks persisted or provider reconciliation evidence before terminalization.
- A canonical pending or retryable signup welcome is obsolete once durable auto-reply provenance proves a newer accepted reply for the same recipient route. Hosted collection must abandon that welcome before provider dispatch; a `sending` welcome remains under the normal delivery-confirmation contract rather than being hidden mid-flight.
- Accepted canonical Linq signup welcomes require a completed delivery-outcome callback even when they answer no conversation mailbox item. Web records acceptance and materializes the provider's direct chat in one transaction under existing route ownership locks; callback failure is a may-have-succeeded delivery, and replay relies on the canonical provider idempotency key instead of issuing an ordinary duplicate send.
- Assistant Ask uses `assistant.ask.requested` and
  `assistant.ask.completed` in the existing encrypted mailbox as its only
  durable queue and operation state. Stable request and completion identities
  make exact replay idempotent and keep the first committed answer. Retries stay
  pinned to the original target and membership generation; expiry is the
  existing ten-minute mailbox deadline, with no second lease, timer, status
  row, or delivery ledger.
- A target runtime may run at most one `executeReadOnlyAssistantAsk` child beside
  its resident foreground turn. The child is a separate one-shot process and
  cannot write or send, so its startup, provider latency, failure, or retry must
  not block or poison the foreground process. Further asks remain pending in
  the mailbox. Before checkpoint, invocation return, shutdown, fence loss, or
   workspace replacement, the runtime interrupts the exact child, waits a
   bounded grace period, terminates only that proven-owned process if needed,
   requeues unfinished work, and proves exit before releasing the workspace.
- Automatic meal-photo uploads are replay-safe only through the capture id derived by the enrolled installation. Each staging attempt must own a distinct object. Under the per-capture mailbox lock, the first accepted item chooses the canonical object for exact duplicates; later attempts delete only their own losing object. Failed or ambiguous appends must reconcile the mailbox claim before cleanup so they never delete an accepted object's bytes. Web must reject conflicting reuse, re-signal exact mailbox duplicates, lock the hosted member and active sponsorship source rows before rechecking final upload authority, and acknowledge an upload only after private object staging and canonical mailbox append both succeed. Runtime import must check the canonical external reference before writing, verify staged length and SHA-256 before import, and delete staging only through a post-checkpoint effect; cleanup derives the user-namespaced object path without requiring encryption-context rediscovery. After failed cleanup, the R2 lifecycle rule makes staging eligible for asynchronous deletion at 31 days, one day beyond mailbox recovery retention, rather than guaranteeing deletion at that exact age. A missing control client, staged object, write fence, mailbox append, or runtime read is a visible retryable failure rather than a successful setup/upload.
- Tool-enabled assistant provider turns should disable automatic model retries once local side-effecting tools are in play, so bounded assistant/vault operations are never replayed implicitly by transport-layer retry. Bound tool execution failures should be returned to the model as structured tool results so the model can recover inside the same turn instead of aborting the provider turn.
- Clinical Records retrieval is generation-fenced and page-idempotent. A
  server-derived run/page fingerprint deduplicates caller request ids without
  persisting them or page URLs; claim-version compare and swap prevents a
  replaced stale claimant from double-counting, settling, or releasing its
  successor. Completed recovery replays remain bounded and charged without
  incrementing logical page progress. Credential-version compare and swap
  prevents stale refresh failures from clearing a newer token. Preemption
  requeues the same run and preserves page progress. The initial backend lane
  permits one retrieval generation per member/provider connection; retry,
  reconnect, and refresh remain closed until immutable raw references have a
  bounded retention lifecycle.
- Clinical provider calls use manual redirects, 20-second FHIR timeouts,
  15-second token timeouts, bounded streaming reads, 5 MiB/page, 500 provider
  fetch attempts, 32 MiB charged egress/run, and exact-family pagination. The
  full page allowance is reserved before FHIR egress and settled only after a
  valid response; ambiguous provider-side failures retain the full charge. A
  401/invalid-grant requires
  reauthorization, a 403 degrades only the affected family, and retryable
  transport/429/5xx failures do not silently terminalize useful credentials.
- Hosted generated-image turns must fail before the provider call if the runtime platform has no generated-image uploader, and must treat Cloudflare Images upload failure as a structured tool failure rather than silently returning inaccessible media.
- Hosted generated voice memo turns must treat ElevenLabs generation, Linq attachment upload, or Telegram delivery-time generation failures as structured tool or delivery failures. Final Linq and Telegram voice memo sends are not replay-safe unless the provider later documents idempotency for those native voice-message endpoints, so outbox transport idempotency must stay false for voice memo media and retries must follow the confirmation-pending/fail-closed path.
- Hosted clinical-record retrieval is finite by resource-family, page-count, page-size, total-byte, per-page resource-count, and total resource-count caps. Runtime stops with a fixed terminal result before import when a provider page would cross a raw-manifest resource cap. Its durable work identity is the pointer-only mailbox `{runId, generation}`; exact validated page URLs—not randomized cursor ciphertext—own logical provider-page identity. Web owns run-bound opaque cursors and provider claims, while vault-usecases atomically checkpoints each accepted bounded page under `.runtime/operations/clinical-records/**` before honoring foreground preemption. A retry resumes at the next unfinished cursor without replaying completed pages. Raw pages plus the manifest commit atomically only after semantic validation and a fresh web authority check; canonical mutation receives a second authority check. Byte-identical replays are idempotent, conflicting replay bytes fail closed, and terminal completion or rejection clears the operational checkpoint. `authorization-required` is terminalized by web and must not receive a second runtime outcome.
- Cloudflare container and Durable Object RPC methods must be invoked directly on the platform stub, not detached, bound, wrapped, or passed around as ordinary callbacks. Test doubles for hosted runner/container seams should model that direct-call contract so local coverage catches receiver/proxy mistakes before they become accepted-but-stuck runtime work.
- Assistant turns and outbound sends should prefer system-emitted receipts plus idempotent outbox intents over model-authored logs. The receipt trail must stay non-canonical, compact, and safe to inspect through `murph status` / `murph doctor` even when transcripts are partially corrupted.
- Assistant observability and recovery surfaces should stay persisted and replay-safe: diagnostics/status snapshots must tolerate missing files, and fault-injection coverage should exercise retryable provider/delivery/automation failure paths before those recovery hooks are trusted.
- Observability writes (logs, latency traces, diagnostics, metrics) must never block user-facing latency: queue or fire-and-forget them off the reply hot path and flush at invocation end, per the `Foreground Reply Critical Path` invariants in `docs/contracts/00-invariants.md`. Only warn/error crash-tail writes may block, bounded by the process exit backstop.
