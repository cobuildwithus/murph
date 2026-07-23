# Reliability

Last verified: 2026-07-22

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
- Closed integration-ingest months compact only in the abortable hosted idle-shutdown lane. Core publishes a verified deterministic gzip before deleting raw bytes, normal readers and amendments stream bounded gzip output, and startup repairs only an independently valid, newline-terminated, byte-identical raw/gzip pair. A wake preserves foreground priority; a 30-second pass budget or ordinary compaction failure leaves any unfinished source intact and does not block checkpointing. Remaining raw months are the next pass's durable worklist, while a non-identical representation pair fails closed without a repair queue or marker.
- The single group newsletter automation reuses canonical cron occurrence state for both delivery modes. Current-chat editions finish through the ordinary conversation outbox and its route retry policy. A scheduled non-direct Telegram occurrence resolves its exact Web-owned route before group tools or model work, persists that authority with the outbox intent, and rechecks it before provider entry. Missing route authority remains retryable; a locally mismatched target fails stale, while live ownership revocation fails permanently without sending. Email editions alone use the existing newsletter parent/recipient outbox lifecycle. The runtime appends the current execution contract on every occurrence so legacy saved instructions cannot retain a retired workflow; no migration queue, repair state, or second scheduler exists.
- A usage-credit purchase persists one reconstructible `created` purchase before
  Stripe I/O; that row and the single purchase-status lifecycle are the durable
  ambiguity fence. Every create retry during the first 30 minutes uses the
  same purchase-derived Stripe idempotency key, leaving at least 60 minutes on
  the frozen Session expiry. An ambiguous response must
  not mint a replacement purchase or create a second payable Session. The
  member may begin another purchase only after the existing one is terminal.
- Family usage-credit creation rechecks owner, group billing, active membership,
  and beneficiary status inside the purchase transaction. Exact request-key
  replay keeps the already-frozen purchase identity but rechecks mutable Family
  authority before releasing any payable capability; every fresh key also
  reauthorizes current state. The same server-owned capability projection runs
  again after Stripe Session creation, and on ambiguous provider recovery,
  before returning a Checkout URL or retry permission. Personal,
  hosted-group, and Family return scopes are frozen distinctly so payer-wide
  active-purchase recovery cannot confuse an owner self top-up across targets.
  Every conflicting request may expose status and cancellation only: it must
  not continue Stripe creation, return a Checkout URL, or offer retry in any
  ordered combination of personal, hosted-group, and Family targets. Settings
  and hosted-group funding suppress every new amount picker while the payer has
  an active purchase and map a different target to status/cancel-only recovery.
  The server projects a departed Family beneficiary as status/cancel-only and
  does not decrypt or serialize its Checkout URL, including when membership
  changes while a Stripe request is in flight.
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
- Scheduled group Assistant Ask stays inside the ordinary scheduled Codex turn:
  start the selected requests, then use ordinary shell waits and exact replay to
  poll every accepted request until it returns completed or unavailable. The
  existing ten-minute request expiry bounds the loop. The cron owner revalidates
  current automation and route authority before every Murph tool call, and Web
  revalidates disclosure authority before returning a stored result. Waiting
  does not hold a callback open, wake the runtime, start another provider turn,
  create an outbox delivery, or introduce another retry owner.
- A target runtime may run at most one `executeReadOnlyAssistantAsk` child beside
  its resident foreground turn. The child is a separate one-shot process and
  cannot write or send, so its startup, provider latency, failure, or retry must
  not block or poison the foreground process. Further asks remain pending in
  the mailbox. Before checkpoint, invocation return, shutdown, fence loss, or
   workspace replacement, the runtime interrupts the exact child, waits a
   bounded grace period, terminates only that proven-owned process if needed,
   requeues unfinished work, and proves exit before releasing the workspace.
- Automatic meal-photo uploads are replay-safe only through the capture id derived by the enrolled installation. Each staging attempt must own a distinct object. Under the per-capture mailbox lock, the first accepted item chooses the canonical object for exact duplicates; later attempts delete only their own losing object. Failed or ambiguous appends must reconcile the mailbox claim before cleanup so they never delete an accepted object's bytes. Web must reject conflicting reuse, re-signal exact mailbox duplicates, lock the hosted member and active sponsorship source rows before rechecking final upload authority, and acknowledge an upload only after private object staging and canonical mailbox append both succeed. Runtime import must check the canonical external reference before writing, verify staged length and SHA-256 before import, and delete staging only through a post-checkpoint effect; cleanup derives the user-namespaced object path without requiring encryption-context rediscovery. After failed cleanup, the R2 lifecycle rule makes staging eligible for asynchronous deletion at 31 days, one day beyond mailbox recovery retention, rather than guaranteeing deletion at that exact age. A missing control client, staged object, write fence, mailbox append, or runtime read is a visible retryable failure rather than a successful setup/upload.
- Automatic meal import is complete only after the stable 9pm managed automation exists. Capture enrollment and upload require a current active private route, including a verified email fallback, which Web includes in the private mailbox envelope. The import writes the canonical meal first, then idempotently ensures that automation from the envelope route; if the upsert fails, the mailbox item stays retryable. Direct email delivery replaces the saved address with the current verified address through the existing signed Web-control boundary before every provider call, and fails closed when Web no longer returns one. The accepted capture mailbox row counts as recent member activity for the existing 28-day automation-engagement gate, so a stale Linq route cannot strand the system-lane import or its closeout; the gate still pauses members with neither recent conversation nor capture activity. A same-workspace retry finds the existing meal, while a retry from the last checkpoint safely repeats the deterministic canonical write before ensuring the missing postcondition. The automation uses the ordinary cron planner and delivery path. `meal closeout-work` derives one bounded batch directly from canonical meals: same-occurrence removal revisions first, then the oldest retained automatic-capture photos. The photos remain the only pending-work queue, so old captures eventually drain without a cursor or another state store. If the provider fails after cleanup begins, a photo-removal revision recorded at or after the scheduled occurrence instant remains evidence only for that occurrence's retry; remaining photos and those revisions reconstruct partial work, while a later occurrence cannot resend the completed one. Photo cleanup is a canonical, idempotent meal mutation that fails closed on changed bytes, mismatched manifest ownership, ordinary meal photos, or partial writes.
- Tool-enabled assistant provider turns should disable automatic model retries once local side-effecting tools are in play, so bounded assistant/vault operations are never replayed implicitly by transport-layer retry. Bound tool execution failures should be returned to the model as structured tool results so the model can recover inside the same turn instead of aborting the provider turn.
- Exact-message targeting must preserve existing effect owners. Reply selection is side-effect free until normal delivery, while reactions keep the existing `message-reaction` operation and retry policy. The local service re-resolves the accepted input before either effect. For a reaction followed by `finish_without_reply`, the provider's already-recorded reaction patch—not a later mutable eligibility check—defers suppression evidence until the delivery outcome is known. A marked normal message persists `nativeReplyRequested: true` with its provider target, and both fields participate in outbox fingerprinting, equality, dedupe, and retry. Every `---` bubble from one response segment copies that same pair; unmarked automatic replies remain flat. Invalid or stale refs fail as recoverable tool results before any effect. A marked Linq send may not create a replacement direct chat, and a selected Linq voice-only response must fail before sending because the voice-memo endpoint cannot carry the reply target.
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
  bounded retention lifecycle. The existing Temporal recovery schedule's
  shared mailbox handoff sweep may select at most one exact pending item per
  user; a Clinical Records candidate must be the unconsumed wake for an active
  queued generation. It creates no replacement work or generation.
- Clinical provider calls use manual redirects, 20-second FHIR timeouts,
  15-second token timeouts, bounded streaming reads, 5 MiB/page, 500 provider
  fetch attempts, 32 MiB charged egress/run, and exact-family pagination. The
  full page allowance is reserved before FHIR egress and settled only after a
  valid response; ambiguous provider-side failures retain the full charge. A
  401/invalid-grant requires
  reauthorization, a 403 degrades only the affected family, and retryable
  transport/429/5xx failures do not silently terminalize useful credentials.
- Hosted generated-image turns must fail before the provider call if the runtime platform has no generated-image uploader, and must treat Cloudflare Images upload failure as a structured tool failure rather than silently returning inaccessible media.
- Hosted generated voice memo turns must treat ElevenLabs generation, Linq attachment upload, or Telegram delivery-time generation failures as structured tool or delivery failures. When response media carries a transcript, the existing final channel adapter uses that transcript as the text fallback if audio preparation or delivery fails and reports success only after either audio or fallback text is accepted; it adds no queue or delivery owner. Linq derives the fallback provider-effect identity from the persisted delivery key, or from the attachment identity when no delivery intent exists, so the fallback crosses the existing dispatch fence without reusing the text or native-voice claim. Final Linq and Telegram voice memo sends are not replay-safe unless the provider later documents idempotency for those native voice-message endpoints, so outbox transport idempotency must stay false for voice memo media and retries must follow the confirmation-pending/fail-closed path when the fallback is absent or also fails.
- Hosted clinical-record retrieval is finite by resource-family, page-count, page-size, total-byte, per-page resource-count, and total resource-count caps. Runtime stops with a fixed terminal result before import when a provider page would cross a raw-manifest resource cap. Its durable work identity is the pointer-only mailbox `{runId, generation}`; exact validated page URLs—not randomized cursor ciphertext—own logical provider-page identity. Web owns run-bound opaque cursors and provider claims, while vault-usecases atomically checkpoints each accepted bounded page under `.runtime/operations/clinical-records/**` before honoring foreground preemption. A retry resumes at the next unfinished cursor without replaying completed pages. Raw pages plus the manifest commit atomically only after semantic validation and a fresh web authority check; canonical mutation receives a second authority check. Byte-identical replays are idempotent, conflicting replay bytes fail closed, and terminal completion or rejection clears the operational checkpoint. `authorization-required` is terminalized by web and must not receive a second runtime outcome.
- Clinical retrieval plans are frozen per run. Query-aware work is ordered by
  stable query/slice identity, bounded windows must be non-overlapping, and
  checkpoint completion is recorded per slice while resource-family outcome
  counts remain deduplicated. Legacy checkpoints and manifests remain readable;
  legacy retrieval rows remain on the legacy wire protocol, while newly
  created runs pin `query-slices-v2` for their full lifecycle. Query-aware page
  claims, cursors, fingerprints, and outcomes bind the frozen query-scope and
  slice identity. Plans admit at most 80 slices so the maximum descriptor,
  32 KiB terminal-outcome request, pagination budget, and terminal-error
  fan-out remain inside bounded control envelopes, the 500 provider-page cap,
  and the 100-error cap; this is deliberately independent from the 500-file
  raw-storage cap.
- Epic activates 24 primary query scopes across 17 unique FHIR resource
  permissions. Each granted family expands into all of its query variants. Nine
  time-bounded queries freeze one initial newest-first 90- or 365-day slice at
  run creation; dependency reads and older-window backfill remain separate
  bounded work rather than implicit fan-out.
- Cloudflare container and Durable Object RPC methods must be invoked directly on the platform stub, not detached, bound, wrapped, or passed around as ordinary callbacks. Test doubles for hosted runner/container seams should model that direct-call contract so local coverage catches receiver/proxy mistakes before they become accepted-but-stuck runtime work.
- Assistant turns and outbound sends should prefer system-emitted receipts plus idempotent outbox intents over model-authored logs. The receipt trail must stay non-canonical, compact, and safe to inspect through `murph status` / `murph doctor` even when transcripts are partially corrupted.
- Assistant observability and recovery surfaces should stay persisted and replay-safe: diagnostics/status snapshots must tolerate missing files, and fault-injection coverage should exercise retryable provider/delivery/automation failure paths before those recovery hooks are trusted.
- Observability writes (logs, latency traces, diagnostics, metrics) must never block user-facing latency: queue or fire-and-forget them off the reply hot path and flush at invocation end, per the `Foreground Reply Critical Path` invariants in `docs/contracts/00-invariants.md`. Only warn/error crash-tail writes may block, bounded by the process exit backstop.
