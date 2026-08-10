# Reliability

Last verified: 2026-08-10

## Current Guardrails

- Keep behavior deterministic and documented as the first modules are added.
- Prefer explicit failure paths and actionable errors over silent fallback behavior.
- Native iMessage nutrition-card delivery falls back to its already-derived
  ordinary text only after Linq definitively rejects the app-card request with
  HTTP 400, 415, or 422. Before that text enters the provider, the existing
  outbox atomically replaces the card with its text-only replay and persists
  the distinct stable provider key; an interrupted process therefore replays
  only that same text effect. Capability or route fallback freezes the same
  text-only replay under the original key. Once that transition commits, the
  effective text intent and key also own the current provider attempt and any
  authorized stale-direct-thread materialization; the pre-transition card
  request is no longer recovery authority. An inbound auto-reply carries its
  trusted provider reply thread once as binding delivery; the opaque
  conversation locator is not a provider target, and a duplicate explicit
  target must not change the route kind. Active-turn admission preserves that
  binding while updating only accepted-message and idempotency context. Native
  reply and reaction authorization rechecks the accepted event against the same
  thread binding, so deleting the duplicate does not remove those tools or
  change the provider contract. A capability-check exception or definitive
  app-card rejection writes one bounded warn entry to the durable hosted
  runtime log before the existing text recovery, because container
  stdout/stderr never reaches a queryable sink; an ordinary `available: false`
  result is expected and silent. The entry is fire-and-forget,
  allowlist-projected observability: it adds no state, retry, or user latency,
  never copies error messages, and contains no message, route, delivery-key,
  credential, or provider body values. Transport ambiguity, timeouts, rate
  limits, and server failures remain failed delivery attempts and must not
  start a second send.
- Connected-app email sends have no durable provider idempotency key or send ledger. Admit them only from current accepted user input in a private direct turn; scheduled, group, maintenance, system-notification, and output-only turns fail before provider egress. After an ambiguous dispatch, never replay the send. Reconcile only against a narrow recent Sent-mail window matching the primary recipient, subject, and substantive body, and leave the outcome unknown when that evidence is not decisive.
- Update architecture and verification docs in the same change that introduces new runtime entrypoints.
- Avoid hidden coupling between scripts, docs, and runtime code; document new dependencies in `ARCHITECTURE.md` and `agent-docs/references/testing-ci-map.md`.
- Codex App Server owns managed OpenAI standalone web search. Its exact
  `POST /v1/alpha/search` request uses the existing signed provider credential
  and Worker egress owner; a provider rejection remains the current tool
  failure and must not create a Murph-side retry, fallback search provider,
  queue, or durable search state. Unsupported methods, paths, providers, and
  invalid runtime identity fail closed before Worker-owned credential
  injection.
- Health-data withdrawal commits its revocation boundary, then waits for the
  existing per-user Cloudflare execution owner to serialize with earlier
  ensures, re-read the Web-owned grant, clear the write fence, and stop the
  runner before acknowledging success. Later ensures re-read consent under the
  same lock. Renewal waits behind the earlier stop, commits its new grant, then
  signals the existing Temporal workflow. Best-effort provider cleanup failures
  are secret-safe, do not roll back the grant, and may be retried idempotently
  by repeating withdrawal.
  Webhooks finalize an already-claimed trace without appending dirty work;
  scheduled selection and wake admission both exclude explicit revocation; and
  queued model work rechecks authority before usage is consumed. Renewal is a
  new durable grant, not an implicit cleanup rollback.
- Venice core inference requires one optional Worker secret. The regular
  Venice GPT-5.6 Luna/Terra/Sol mapping is code-owned and derived at egress;
  there are no duplicate model vars that can become partial or mismatched.
  Web keeps Venice hidden and projects OpenAI until the Worker/runner
  deployment has been verified. Unsupported paths/models, malformed JSON, and
  request bodies above 20 MiB
  fail closed before provider egress. Rollback removes Web exposure first; it
  does not add a queue, repair pass, provider fallback, or second preference
  owner. Codex Responses Lite `/responses` requests also receive one explicit
  prompt-cache breakpoint at the end of their stable leading developer prefix,
  while retaining Codex's stable cache key and Venice's implicit-cache fallback.
  Activation requires two sequential, capped requests from one resumed thread
  through the exact candidate's pinned Codex App Server, not hand-authored
  ordinary Responses payloads. Candidate proof must join that real Responses
  Lite envelope to the production Worker transform and show the stable key,
  restored tools, removed `additional_tools`, and one correctly placed marker.
  The live second request must report a nonzero cache read and materially fewer
  cache-write tokens. Otherwise Venice remains hidden and rollback begins at
  Web exposure.
- Web selects immutable allowance rates from both the canonical product model
  and recorded provider. Venice standard usage uses Venice's documented
  input, cache-read, cache-write, and output rates and records the provider
  model and pricing source in the snapshot; unknown non-Venice standard
  provider evidence retains the existing OpenAI-compatible behavior.
- An authenticated Settings provider change commits Postgres first and then
  sends the payload-free `runtime_wake_requested` Temporal signal. The per-user
  workflow coalesces duplicate wakes as one boolean and calls the existing
  Cloudflare processing adapter even when Web facts are otherwise idle. A warm
  invocation compares its provider snapshot with the live preference,
  stops servicing further wakes on mismatch, checkpoints, and returns the
  existing immediate-recheck edge. This prevents repeated orchestration wakes
  from starving the handoff checkpoint. Blocked facts discard the wake;
  accepted processing clears it only when no newer wake arrived. Signal failure
  preserves the durable save, and the next invocation plus provider-entry gate
  remain the fail-closed backstop. The existing `runtime_recheck_requested`
  signal remains facts-only. This adds no mailbox item, direct wake, provider
  fallback, queue, or second preference owner.
- Direct hosted Codex process projection includes the selected core provider
  and only that provider's signed egress credential. Changing providers
  therefore changes the warm-process launch identity; the replacement process
  cannot inherit the prior provider's endpoint or credential.
- Explicit remote verification is fail-closed. The dispatcher never retries on
  another executor or runs local and remote copies together; an operator may
  retry the same head only after recording a concrete infrastructure failure.
  Each admitted run uses one logged immutable Git candidate, so later checkout
  writes cannot change the work in flight. Static SSH gives every invocation a
  unique remote directory. Missing, malformed, or unresolvable local host, user,
  or port routing fails before remote execution; no other executor is selected.
  After the worker lock is acquired, native `tar` plus the production-compatible
  `zstd` stdin round trip must pass before Git reconstruction, installation, or
  candidate verification. The entrypoint internally selects `profile=static-ssh`;
  that profile ignores caller scheduling overrides and admits composed
  acceptance only when the worker reports both at least 10 logical CPUs and
  24 GiB of physical memory. The bounded capable plan retains the CLI release
  interlock and aggregated failure propagation; smaller or memory-unobservable
  workers retain the serial fallback. Its readiness line, plus the `resources`
  line for `verify:acceptance`, are required execution evidence rather than
  optional diagnostics.
  Crabbox's nested static lease and repository directories still resolve to one
  native macOS `lockf` descriptor above the run root, which remains the
  worker-capacity authority. A busy worker fails closed. The remote verifier
  inherits that descriptor, retains it while reaping its exact child process
  groups after `SIGHUP` or transport loss, and holds a native `caffeinate`
  idle-sleep assertion for the same finite lifetime. It then validates and
  removes only its exact outer run directory. The local artifact lock protects
  cooperating local producers and candidate capture; it does not claim remote
  completion. Availability before admission and shutdown stay outside Murph
  rather than introducing a daemon or lease-recovery owner.
- Use the concrete runtime contracts first: hosted runner wake/checkpoint behavior lives in `agent-docs/references/hosted-runtime-protocol.md` plus `apps/cloudflare/README.md`; deploy recovery and smoke expectations live in `apps/cloudflare/DEPLOY.md`; local device-sync and assistant daemon retry/control-plane behavior live in their package READMEs and tests.

## Runtime Expectations

- Initial onboarding has one Postgres completion owner across website and
  native clients. Existing members are backfilled complete. During the
  migration-first rolling deploy, a temporary database default also completes
  inserts from the still-serving legacy writer; the current member creator
  explicitly writes null for genuine new-flow members. Retire that default in
  a later migration only after the legacy writer has drained. New-member save
  or skip locks the member row and records preferences plus completion in one
  transaction; the first completion wins and later attempts return an
  idempotent completed projection without preference mutation. A failed write
  leaves the picker mounted with its unsaved choices, while an unavailable
  best-effort runtime wake does not roll back durable completion. Native
  foreground refresh and every authenticated Home load re-read the canonical
  fact; query markers and Web-session history do not gate the flow. A
  user-initiated device or connected-app completion result takes foreground
  priority on Home, and closing it refreshes plain Home before pending
  onboarding renders. Optional Web and native contact projection fails soft to
  no contact-card step while the catalog and Health continuation remain
  available. No local flag, lease, cleanup worker, or second reconciliation
  owner exists.

- `packages/assistant-engine` owns one resident Codex App Server process and one
  memoized readiness promise on that process. Readiness covers spawn plus the
  App Server initialization handshake; it does not reserve the process for a
  turn. Matching preparation callers join that same promise, while a matching
  foreground turn synchronously reserves the exact process before joining its
  readiness. Hosted preparation is a one-shot decision from the first fresh
  auto-reply-enabled pre-pass conversation candidate: Linq or Telegram may admit
  it; email, self-authored Linq, bootstrap, system, maintenance, replay, and
  active-turn imports may not. The existing engine-owned slot-transition lock
  serializes inspect, exact teardown, publication or reservation, and
  workspace-boundary admission; it is not held while initialization readiness
  runs. The admitting caller receives a cancellation handle bound to that exact
  process, so a stale caller cannot cancel a later replacement. There is no
  second lock or readiness owner.
- Every App Server stop path rejects all pending JSON-RPC requests promptly and
  tears down the exact process object. Speculative preparation never replaces a
  healthy claimable resident with another launch identity; only authoritative
  foreground acquisition may do that. Preparation failure, timeout, abort, or
  unhealthy-process replacement must finish exact teardown before a fresh
  process is published. Late completion from the old object cannot mutate the
  resident slot, and a foreground turn falls back to ordinary fresh startup
  only after failed preparation is fully cleared; preparation failure never
  consumes or silences accepted work.
- Before snapshot construction, the checkpoint owner first closes and joins
  asynchronous preparation admission, then cancels and awaits exact teardown of
  readiness that is still pending and unreserved. Invocation release performs
  the same join. A ready idle process remains on the existing warm-process path;
  a reserved or running process remains on the existing turn-quiescence path.
  The slot owner marks the full boundary call active: resident preparation
  declines and warm
  foreground or account acquisition begun while it is active fails busy rather
  than queueing new publication behind it. A caller that already obtained a
  slot-transition ticket retains FIFO priority, so the boundary observes that
  process or fails busy rather than overtaking it. The boundary holds the
  slot-transition lock only through the exact-process decision and any
  pending-preinitialization teardown or ready-process reservation. The
  potentially long background-work wait then runs outside the lock under that
  reservation. The hosted conversation warm lease remains 20 minutes, and
  process-only initialization neither extends that lease nor adds keepalive
  traffic.
- The production database-health operator alert is an independent Cloudflare
  singleton so the monitored Postgres database cannot take down its own page
  owner. A five-minute Cron Trigger records one normalized PlanetScale sample
  or classified failure in Durable Object SQLite and prunes history after 30
  days. A two-minute persisted run lease coalesces overlapping cron delivery.
  Concrete unhealthy gauges page immediately. Metric families are normalized
  independently: an absent or structurally unusable family remains unknown,
  its canonical allowlisted name is retained with the failed sample and warning,
  and every available signal is still evaluated. No unknown value becomes zero.
  Discovery, scrape, parse, or incomplete required metrics must recur on two
  consecutive runs before paging the monitoring condition. Crossing that
  threshold persists one bounded telemetry-page obligation in the existing
  incident row. The represented first two-check window counts incomplete versus
  unavailable observations, unions only canonical missing families observed on
  partial checks, and uses the threshold time as its window end. One bounded
  evidence value on each existing sample preserves that aggregate provenance
  across restart. The obligation survives an occupied pending-message slot,
  restart, recovery, and direct-error-only prioritization; only acknowledgment
  of a pending body that includes the monitoring condition clears it. Recovery
  and another threshold before acknowledgment deliberately coalesce into that
  unresolved notification, retaining the first threshold window; this monitor
  does not maintain an outage backlog. The additive columns retain the existing
  schema version so a rollback Worker can ignore them. Current code recognizes
  the prior Worker's cleared pending key/body with the telemetry marker still set
  as an acknowledgment and removes the stale obligation before re-admission.
  A newly opened incident or one-shot direct migration admission failure admits
  its exact body and idempotency key in the same synchronous SQLite transaction
  that persists the sample and advances any direct-error counter baseline.
  If another immutable page already owns the single pending-message slot, the
  same transaction advances the sample baseline and accumulates the later
  direct-error count plus latest check time in the existing alert row instead
  of dropping it. An acknowledged older page cannot close the incident while
  that evidence remains. The next run with a free slot atomically promotes the
  accumulated count into one non-replayable page, retaining any owed telemetry
  condition in the same body, which then follows the ordinary attempt fence,
  health preflight, exact-body retry, and restart contract.
  When a direct error forces admission inside an acknowledged incident's
  closed attempt fence, that pending body contains the non-replayable direct
  error plus any durable telemetry obligation already available at admission;
  co-occurring replayable gauges remain in the persisted sample but cannot
  become stale pending claims. Pure deferred evidence keeps its stored check
  time; when a current direct-error delta joins the promoted count, the page uses
  the latest included check. Historical telemetry carries its separate
  observation time. That exact combined page owns the next eligible attempt and
  acknowledgment clears the represented telemetry obligation, avoiding a
  second notification lifecycle.
  A replayable condition still unsafe at that boundary remains eligible for the
  following paced recurrence. The same one-slot ordering applies in reverse: a
  later direct-error obligation waits behind an older page but cannot be consumed
  by the counter baseline. This explicit prioritization keeps admitted bodies
  immutable without another message queue or delivery lifecycle.
  An acknowledged incident's replayable gauge does not admit stale evidence
  while the attempt fence is closed; once the fence opens, a still-unsafe
  current gauge admits the recurrence. An unadmitted monitoring obligation does
  not occupy a closed provider fence. Until an incident admits its first page,
  concrete evidence, including a direct-error delta, that appears on the
  threshold or a later sample persists in one combined immutable body with
  exact identity, concrete check time, and
  condition-local telemetry time; both facts share the first eligible attempt
  and one acknowledgment cycle. For an acknowledged-incident
  recurrence, the first eligible sample supplies any still-current concrete
  evidence and historical telemetry carries its own observation time. An
  acknowledged telemetry-only notification is one-shot while collection remains
  continuously incomplete or unavailable; its current samples remain queryable,
  but they do not admit repeated pages or add monitoring copy to concrete-pressure
  recurrences without a currently owed obligation. A complete healthy sample
  cannot discard an unacknowledged telemetry obligation or rearm a separately
  recovered gap.
  Once any owed page is acknowledged, complete collection closes that incident
  and rearms telemetry. An already pending page is
  processed or deferred before a later clean sample can close the incident,
  and only an acknowledged provider response clears it. Provider entry is
  globally fenced by the persisted last-attempt
  timestamp, so neither a new incident, recurrence, retry, nor worker restart
  can attempt Linq more often than once every hour. The attempt time is
  actual wall time, not the Cron slot, and is written before network egress.
  The message's UTC check time likewise comes from the actual completed
  collection run while the Cron slot remains only the persisted sample
  identity. Every eligible cycle independently retrieves both configured
  direct chats and current line reputation; unhealthy or indeterminate health
  suppresses that destination's message POST without blocking the other
  destination, and retains the pending alert for the next paced cycle. Healthy
  destinations are compared before provider entry. Primary recipient identity
  is required before any secondary POST: an unresolved primary identity
  suppresses both positions, while an unresolved secondary identity does not
  block a healthy primary. A known primary identity with unhealthy or
  indeterminate delivery health still permits a healthy distinct secondary
  POST; the suppressed primary keeps the page pending.
  Distinct chat ids that resolve to the same external recipient admit only the
  primary POST and keep the page pending; after configuration is corrected,
  stable provider
  idempotency deduplicates that primary replay while the actual secondary
  receives the page. Delivery otherwise uses Linq's no-`from` auto-selection
  route separately for each chat. The primary retains the persisted Linq
  idempotency key and the secondary uses a stable derived key. A
  transport-ambiguous or rejected send keeps the exact persisted body and both
  destination keys for the next eligible cycle; only acknowledged entry to both
  distinct recipients clears the pending alert. An idempotent replay of a
  destination that already succeeded cannot produce another recipient-visible
  message. Acknowledged concrete-condition recurrences advance the alert
  sequence and deterministically select from one hundred reviewed,
  observation-scoped openings by persisted incident and alert identity. An
  opening may say only that the recorded check met alert criteria; current-state
  or condition-specific claims must come from evidence that proves them. The
  recorded evidence and check time make each body specific, while a retry
  retains that truthful exact body after recovery. The bank size is an explicit
  bounded operator deliverability contract rather than a claim about platform
  filtering: at the hourly cap, one incident traverses one hundred reviewed
  leads before repeating one. Literal reviewed data avoids a prose generator,
  provider dependency, or second runtime copy owner.
  Telemetry-only copy instead states that monitoring is incomplete or
  unavailable and cannot claim that the database itself is under pressure.
  Message variation must remain contextual and deterministic, never random
  padding, filler, invisible characters, or provider-generated prose. Database
  pages intentionally have no quiet hours.
- Linq edit delivery is at-least-once and remains owned by the existing hosted
  mailbox. A per-source advisory lock serializes correction planners from
  lineage read through correction append; ordinary accepted messages write the
  blind source index without taking that lock. An edit that races an
  uncommitted original sees the source as missing and returns the existing
  retryable response so a provider retry observes the committed original.
  Provider event identity makes exact replay idempotent, changed replay
  conflicts, stale edits cannot replace newer corrections, and equal
  timestamps fail closed as ambiguous. One original plus the provider-supported
  five corrections is the hard lineage bound. If an edit arrives before its
  original, Web returns a retryable response only during Linq's documented
  retry horizon and then terminates without inventing a local pending queue.
  Roll out the nullable source index first, deploy readers and ordinary-message
  writers next, wait through the maximum edit plus webhook retry window, and
  enable the `2026-02-03` edit subscription last.
- Linq instant start uses the existing planner twice around the existing no-card Pulse-trial owner. The first transaction may create the canonical member, verified inbound phone identity, pending same-line route, and invite, but it neither counts the inbound nor appends the conversation. The invite records the persisted model-source admission event and is the single-owner token for that exact original inbound. Only the transaction whose unique phone-identity insert actually creates a genuinely new member may mint the token; if another inbound wins that identity during classifier latency, the admitted planner re-reads the winner under the shared participant-phone lock, cannot mint a token, and follows the ordinary signup-link path without attaching its event to the winner's invite. While a token remains pending, a different inbound for the inactive member exits retryably before accounting or side effects instead of continuing or canceling the start. Stripe customer/subscription provisioning, the billing write, and activation share the existing member lock; before any Stripe mutation that owner revalidates the exact invite and event, and activation clears the token in the same transaction. The event-time start source travels in the same Stripe subscription metadata and billing write, so recovery retains `linq_instant_start` without another provider call or authority; older metadata with no source remains Unknown. Stripe calls use the existing five-second, no-network-retry authority budget. A second ordinary planner pass observes active access, promotes the route, counts the original inbound once, and appends it once. Later inbounds then take the ordinary active-member path. Only a genuinely new billing identity can enter this path; an existing Stripe customer falls back before subscription creation so a saved card cannot silently auto-convert. Any classifier, configuration, route, definitive Stripe, or activation failure falls back to the existing signup-link path, while the single-owner wait remains provider-retryable, without creating a second entitlement, queue, or runtime.
- Card-based website Pulse trials carry `web_onboarding` in both the existing
  Checkout Session and subscription metadata. Completion reads the canonical
  subscription value already required for entitlement validation and writes it
  atomically with trial redemption. A repeated completion cannot replace that
  accepted write, standard paid Checkout carries no trial source, and legacy
  in-flight trial Checkout without source metadata remains Unknown.

- Define startup requirements, health checks, and critical invariants.
- Document retry/idempotency expectations for writes or background work.
- Add tests for failure modes before relying on production-side recovery logic.
- Account deletion must not discard its only external-cleanup owner. The
  canonical account transaction persists the KMS-encrypted, foreign-key-free
  receipt before deleting the member. The existing hourly retention sweep
  retries Cloudflare, Stripe-customer, and Privy-user targets independently;
  confirmed absence is idempotent success, completed targets are skipped, and
  unconfigured, timed-out, or ambiguous targets remain pending. The deletion
  request returns `cleanupPending` immediately after the canonical transaction
  instead of waiting on those providers. Each retention attempt has a bounded
  target deadline, and the bounded batch runs receipts concurrently so one
  stalled vendor does not block unrelated retention work. Because every
  provider delete is idempotent and progress is monotonic, concurrent attempts
  may duplicate a provider request but cannot erase completed progress or
  report convergence before the receipt itself is deleted.
- Every direct subscription Checkout attempt is an encrypted member-owned row;
  Family retains its single encrypted session in the existing billing attempt
  owner. A first-time direct subscription Checkout never pre-creates a
  standalone Customer: subscription-mode Checkout creates it only when the
  owned Session completes, and completion binds the Customer and Subscription
  together. Direct Checkout completion prepares its live provider snapshot,
  encrypted billing identifiers, and email before taking the member lock; the
  transaction only revalidates durable ownership, accepts the existing attempt,
  and writes the prepared values. Pulse Session metadata resolves only the
  member ID: after taking that lock, completion rereads the authoritative
  redemption, phase, status, and subscription lookup key before deciding
  whether an identity is replaceable. That decision read selects no encrypted
  fields and therefore cannot call KMS. A loser preserves the current identity
  and is canceled after commit; an unexpected policy rejection after acceptance
  aborts the transaction. Before browser or webhook completion takes the member
  lock, it durably provisions only control and ingress through their existing
  short transactions, unwraps both into the request-scoped cache, and prepares
  ephemeral device and runtime candidates. Complete root presence is also
  activation proof for group participant projection, phone-call authority, and
  activation recovery, so those final candidates become durable only inside the
  accepted winner transaction. The locked winner path selects only attempt,
  lookup-key, freshness, and entitlement scalars, writes the accepted scalar
  trial facts, and lets private-field batch projection reuse the concrete root
  keys already in the scoped cache; it does not project a rich billing snapshot
  or make a KMS request. Stripe event reconciliation likewise prepares its
  canonical provider snapshot before the lock and revalidates the database
  owner inside it. After Stripe creates a session, Checkout creation
  re-locks the owner and returns the URL only after binding that reference; if
  suspension or deletion won, it expires the session instead. Account deletion
  suspends first, re-reads all direct attempts and Family billing owners,
  expires every open session, absorbs an expiry/completion race by canceling
  the resulting subscription, and reuses the exact bound direct-PaymentIntent
  cancellation owner before preparing the final customer-cleanup receipt.
  Provider `processing` or `succeeded` state remains a deletion blocker; only a
  provider-proven cancellation may terminalize local `payment_pending` state.
  Pulse Trial loser cleanup validates exact provider targets before one short
  member-owner revalidation transaction and cancels them only after that
  transaction releases; no Stripe request is made while that lock is held.
  Direct paid and direct Trial conversion to Family updates the exact existing
  Subscription in place under the owner lock, clears Trial-only metadata, and
  ends a Trial immediately instead of creating a competing Subscription. A
  stale local owner or changed Stripe source fails before that update. If an
  older competing Checkout nevertheless pays after Family wins, the ordinary
  invoice reconciliation owner cancels it and attempts only the exact full
  one-invoice/one-payment refund; partial refunds, balance credit, credit notes,
  pagination, or multiple allocations remain support-required rather than
  guessed.
- Stripe receipts poison after the normal attempt cap when a failure remains
  permanent, regardless of whether the owning billing transaction already
  committed. Concrete Stripe/Prisma/network failures remain retryable, and a
  committed entitlement's required runtime recheck is wrapped as an explicit
  retryable obligation. Replay-safe cleanup or notification work does not gain
  blanket retry authority merely because it runs post-commit. No second queue
  owns redrive.
- Immediate paid-plan upgrades use a one-item Customer Portal
  `subscription_update_confirm` session rather than a Murph-owned Subscription
  mutation or pending-invoice retry loop. Web takes the member lock only to
  read and later revalidate the exact billing owner; Stripe retrieval and
  Portal-session creation happen between those short transactions. The session
  binds the exact Customer, Subscription, current licensed item, allowlisted
  target Price, and dedicated Portal configuration. A changed owner, scheduled
  change, pending update, legacy second item, or unknown add-on fails closed.
  Stripe webhooks remain the retry and local-reconciliation owner after the
  customer confirms the change; the unsigned return query is display/polling
  context only and never entitlement authority.
  Renewal scheduling also rejects `cancel_at`, paused collection, manual
  collection, and any existing schedule before it creates a new Stripe
  schedule, because those states do not have one unambiguous renewal owner.
- Stripe failure email reuses the shared operational Resend transport as a
  best-effort projection, never a retry or billing owner. Only an action owner
  schedules a metadata-only operation alert when a Stripe rejection actually
  aborts the complete billing action. Checkout owners cover mandatory price
  lookup, customer provisioning, saved-card preparation, and Checkout Session
  creation/resume; paid-plan upgrades, paid-trial transitions, and scheduled
  plan switches likewise report only after the complete provider-backed action
  fails. No individual provider call is a separate alert occurrence. Family
  replacement attempts rebind alert identity to the current
  attempt, while direct paid upgrades include the complete current-plan,
  current-Price, target-Price, and seat-count provider effect. Paid Family
  capacity changes reuse the exact Stripe capacity-update idempotency identity,
  and member-tier swaps reuse their persisted transition identity. Their
  already-applied, successful, and domain-only outcomes remain silent. An
  explicit
  group-sponsorship recovery owns a terminal provider rejection, but a
  no-charge capacity reactivation remains silent. The final Murph-owned Family
  redirect reports a blocking Session-read rejection only when the unique blind
  Session binding still names a current attempt; unknown, cleared, or stale
  public IDs remain log-only. The central diagnostic
  logger remains log-only because it also
  observes recovered reads and cleanup races. Provider adapters that translate
  a terminal Stripe rejection retain only the validated opaque request id in a
  frozen non-serialized correlation record,
  so distinct provider requests do not collapse onto the action fallback key;
  the client-visible hosted error still exposes presence only. The pure
  correlation parser introduces no Next or alert-delivery dependency into the
  general onboarding runtime used by production line sync and standalone Stripe
  tooling. Newly recorded, verified `checkout.session.async_payment_failed`,
  `payment_intent.payment_failed`, `invoice.payment_failed`, and
  `invoice.finalization_failed` receipts schedule event-scoped alerts; and only
  the first failed local reconciliation attempt schedules a reconciliation
  alert. Stable opaque operation-attempt and event-derived keys provide
  provider replay defense inside Resend's external idempotency window.
  Duplicate webhook receipts do not
  schedule another payment alert, later local reconciliation attempts do not
  schedule another reconciliation alert, and missing configuration or send
  failure cannot change the original checkout, webhook, retry, poison, or
  entitlement outcome. There is no new queue, cursor, retry loop, or persisted
  alert state.
- Participant-derived hosted-group access is bounded by the shared seven-day
  observation lease. Provider rosters larger than the reconciliation cap cannot
  leave a participant authoritative forever: stale relationships age out.
  Authenticated Linq inbound can renew only an existing non-removed relationship
  for the currently resolved identity, and future provider timestamps are
  clamped to server time. Before denying a quiet route, Web makes one bounded
  provider read and scans the full returned roster. It may create or reinstate
  exactly the authenticated current sender after the roster handle re-resolves
  to the same active hosted identity; otherwise it may renew only an existing
  active participant whose current identity still matches the stored
  relationship. Provider order and the assistant participant projection cap do
  not decide access.
- Linq participant add/remove context is a bounded optional sidecar on the
  existing routed group, not another work owner. Provider-event deduplication
  and optional staging run in one transaction under chat, owner, then route
  lock order, so the next ordinary group message cannot overtake a unique
  change after ledger insertion and projection cleanup cannot deadlock against
  a labeled append. A unique addition atomically retains the existing anonymous
  route bit; a removal has no send or wake fallback. Identity and
  owner-address-book reads happen only on the
  participant webhook path, never on ordinary message ingress. Optional lookup
  failure falls back to handle-only context, optional staging failure preserves
  the addition bit, and duplicate events never restage. Address-book
  replacement/deletion takes the same owner lock and clears that owner's
  pending optional group-event buffers, so revoked labels cannot surface later
  and ordinary message ingress adds no query. Route-account lookup keys also
  reject Murph's own line when `is_me` is absent. Append and consume retain the
  existing 500 ms context-crypto bound.
- Linq and Telegram group ingress must use the same canonical current runtime
  AI-access decision as model execution before provisioning a group or
  admitting work for an existing thread container. Evaluate that decision at
  webhook processing time rather than the provider message timestamp, so a
  delayed event cannot cross a trial-expiry boundary. A recognized inactive
  Linq sender may receive recovery only when both the persisted route contact
  and the provider's current direct-chat audience match that authenticated
  sender before and after access resolution. Otherwise the group receives only
  account-neutral guidance, and unknown or suspended senders disclose no
  account state. Telegram may create or renew the exact active linked group
  sender's existing participant lease without transferring container
  ownership; delayed observations remain subject to the shared seven-day lease
  and future timestamps are clamped to server time before the canonical
  container decision is re-read.
- New Linq-group ownership preparation adds one bounded, non-retried provider
  roster read before the unbound-group transaction. Provider timeout or failure
  leaves recovery-backed ownership indeterminate and must return the existing
  typed retry before route creation. A completed empty, oversized, or non-group
  result cannot select another member's setup; no eligible intent or unresolved
  ambiguity otherwise preserves the existing active-sender decision. After the
  request-local existing-route and roster preflight, explicit suspension or
  health-data-consent withdrawal prevents route creation and setup outreach.
  Other inactive senders cannot become the fallback owner but do not veto a
  distinct active roster-matched owner. Unknown or inactive non-withdrawn
  senders reach the existing group setup handoff only after the prepared-route
  boundary returns no route. When first-contact admission enforcement is
  enabled, an unknown sender must pass that gate before setup outreach. The
  one-use setup claim and route creation share one transaction. Claim
  eligibility requires
  the setup to cover the provider event time and to remain unexpired at
  processing time, so a delayed pre-arm event cannot spend a newer intent. The
  selected setup row stays locked until route admission finishes and is deleted
  only when that transaction creates the route; rollback and convergence leave
  it unchanged without a compensation lifecycle. A concurrent loser re-reads
  the canonical route and appends its distinct message there. The optional
  setup payload is encrypted and versioned; unreadable or future bytes are
  consumed as unavailable optional setup and fall back to ordinary sender
  admission instead of wedging the room. Hard-blocked-line recovery keeps the
  existing delivery attempt as its retry owner, awaits provider-accepted
  correlation before reporting send success, and treats an exact
  still-uncorrelated attempt as retryable rather than definitive absence. An
  exact pinned recovery retries immediately through the provider's stable
  idempotency key instead of inheriting the generic fifteen-minute
  pre-provider lease. Its claim compares and advances the existing `updatedAt`
  row version while preserving the original `attemptedAt` authority timestamp,
  so one concurrent replay wins without erasing proof that recovery preceded
  an earlier replacement-line event. An uncorrelated recovery provider error
  never locally settles the shared row; it remains in flight until accepted
  correlation or provider-correlated terminal evidence establishes an outcome.
  For a
  newly created route, sparse style is committed in the same transaction
  through the existing
  synthetic-member preference owner. Optional room context rides the existing
  activation wake; its fixed-page initialization is exact-replay idempotent and
  fail-open so it cannot block the accepted first group message.
- Current-chat naming is one on-demand provider read through
  `murph.group action="read_chat_name"`. It uses the current durable route and
  existing bounded Linq or Telegram request timeout and does not retry, cache,
  reconcile, or add a state owner. Provider failure returns `unavailable`; an
  absent title or Linq-synthesized handle label returns `none`. New-group setup
  may continue unnamed after either outcome.
- Group-origin Telegram recovery retains three outcomes in the existing
  delivery owner. Explicit Telegram rate limits persist a retry time;
  provider-confirmed permanent 4xx rejection persists a recognizable definitely
  unsent result so replay retries only the neutral room response; and ambiguous
  no-response or non-rate-limit 5xx dispatch remains terminal and at-most-once
  for the private message.
- Foreground inbox/parser-backed daemon runs should favor restartable connectors with bounded backoff over permanently dead watch loops, while still keeping low-level restart behavior opt-in and always bounded by the owning abort signal.
- Networked assistant/provider/channel calls should set explicit timeouts, propagate caller abort signals, and only auto-retry request shapes that are replay-safe or rate-limit directed.
- Hosted artifact uploads are content-addressed and replay-safe. Transport failures
  plus HTTP 408, 429, and 5xx responses carry typed retryability into the existing
  device-sync job owner, which requeues with its normal bounded backoff. Write-fence
  and authority failures, other HTTP responses, malformed data, and unclassified
  errors remain terminal; the runtime must not create a second artifact retry queue.
- Junction Link setup remains retryable but inert before proof-verified callback
  completion. Webhooks for an active `pending_link` or `link_returned` account
  release their trace claim and return a retryable not-ready response; they do
  not persist dirty state or wake work. Manual reconcile, due scheduling,
  ordinary queued jobs, and sync-success promotion apply the same account phase
  gate. After a shared account is `source_confirmed`, a new target source does
  not move the account back into a pending phase. Its `DeviceConnectionSource`
  remains `disconnected`, and source-attributed webhooks, dirty-state commit
  races, and provider pulls fail or exit without admitting target data until
  callback completion reaches the sole runtime connection-established admission
  boundary. Shared ingress marks every account persistence request with the
  closed `replace` or `preserve_established` policy; hosted Prisma and local
  SQLite apply the same shared predicate inside their persistence transactions,
  so neither adapter may reinterpret a source addition as an account reconnect.
  Hosted admission commits the source, signal, and mailbox work in one
  transaction; local admission commits the source and initial jobs in one SQLite
  transaction. Shared ingress never performs a second source write. A missing,
  disconnected, or newer account makes the callback fail and leaves the source
  disconnected. Established siblings continue normally.
  Starting or retrying the source first attempts target-only provider cleanup;
  a cleanup warning blocks the new link instead of adopting an ambiguous
  linkage or revoking sibling sources.
  Ordinary hosted removal follows the same target-only provider boundary. Web
  marks the selected connection-source row with a disconnect fence under the
  existing connection mutation lock, performs provider revoke outside the
  transaction, then rechecks the parent, credential, and source epochs before
  committing only that source as disconnected. The fence rejects late callback
  admission and hosted-runtime source projection until a fresh explicit connect
  clears it. Provider failure restores the captured source lifecycle and returns
  a retryable error; it does not disconnect siblings or the parent account.
  Connection-wide historical reset remains the explicit broader operation.
  Repeated removal performs target-only provider cleanup again, and a Link
  callback rejected after provider completion uses the same two-phase source
  claim to remove authorization recreated by an obsolete Link. A newer Link is
  not issued while exact-source cleanup is in progress. A start carries its
  exact pending source epoch through provider Link creation and rechecks it
  before OAuth-state persistence and response; a concurrent newer disconnect
  makes the Link unreachable instead of returning stale authorization.
  If obsolete provider completion races an in-flight Disconnect or source-start
  cleanup, it advances that exact operation's source epoch and performs another
  idempotent target-only revoke. The initiating operation follows the newest
  same-purpose claim before returning, while separate start-cleanup and user-
  disconnect phase codes preserve the intended terminal state.
- Companion Apple Health metadata and WHOOP overnight summaries recheck their
  exact source inside the health-data admission lock and again before runtime
  import by rereading the durable source row rather than trusting the queued
  account snapshot. Explicit Apple Health SDK connect captures the exact source
  epoch before token mint and creates a pending epoch afterward only when that
  proof remains current. A signed source-registration lifecycle event with no
  timestamp instead rereads Junction's live provider list after trace claim: an
  unchanged pending epoch plus a live target commits connected, while a fenced
  source or disconnected parent triggers target-only cleanup. Receipt or
  record-occurrence time is not substituted for registration proof. Source
  observation runs after the webhook attempt owns its trace so duplicate or
  losing attempts cannot change authorization. WHOOP summary provenance remains
  `whoop`, but admission uses the Junction `whoop_v2` lifecycle source. Resume,
  omitted intent, stale
  events, and background work never clear the source fence.
- The hosted reply-latency operator alert remains one singleton incident owner.
  Fresh conversation mailbox rows that the existing Web AI usage gate
  intentionally denies receive one assign-once timestamp at the mutating
  reconciliation or mailbox-fetch denial boundary. The database-timed write is
  bounded by the observed replay floor and conversation high-water, happens
  before fallible usage-notice delivery, reuses the existing mailbox work
  owner, and cannot fail the gate. The monitor excludes only chronologically
  valid stamps with no execution evidence. It derives one effective latency
  origin from ingress, staging, provider, delivery, and consumption facts
  before applying its 24-hour window, bounded scan, or delivery/provider
  grouping. Post-denial execution is measured from its earliest milestone even
  when the original ingress is older than the window. An unblocked row sharing
  the same reply remains alertable. The existing seven-day ingress-trace cleanup
  retires a trace only after both its original ingress and latest activity are
  stale, so a resumed trace survives quiet-hour deferral without making
  inactive traces unbounded. Slow completed alerts classify the larger
  accepted-to-provider-start or provider-start-to-visible-response boundary
  without guessing across missing or invalid chronology. Unresolved alerts
  separately count missing terminal evidence and terminal non-replies that
  still lack durable checkpoint acknowledgement. Checkpoint lifecycle telemetry
  exposes the bounded exact-item batch count plus whether that selected batch
  contains the exact conversation frontier, without logging identifiers. The
  plan/start/failure phases prove only local selection; a finished event
  separately says whether Web accepted the checkpoint. Only the accepted
  frontier combination routes an unconsumed row toward downstream Web stamping;
  the count alone never chooses an owner.
  Outbound paging requires the shared Resend operational-email sender and
  recipients plus a valid IANA operator timezone; it never falls back to
  Linq/iMessage. It suppresses sends from 11 PM through 7 AM local time and
  applies stable bounded jitter after quiet hours and after every provider
  attempt. No retry or post-healthy recurrence may call the provider less than
  ten minutes after the prior attempt or accepted-send boundary. A retry that
  may already have succeeded preserves the exact body and incident-scoped
  idempotency key. The key does not vary with mutable email configuration:
  within Resend's idempotency retention window, identical retries deduplicate
  and a changed payload under the same key fails closed instead of acquiring a
  second send identity. The monitor does not claim provider-side exactly-once
  behavior beyond that external retention window. Distinct incidents vary
  through current aggregate evidence and checked-at time, never random padding
  or synonym churn. Fresh health and operator-time rechecks precede the one
  exact row-version compare-and-swap that admits provider entry, increments
  attempt count, and advances the provider-attempt timestamp. The same version
  fence makes a stale recovery coalesce rather than report healthy after a
  concurrent incident cycles back to the same status. Recovery or quiet hours
  before admission leave attempt state untouched: a known-unsent first alert
  later builds current evidence, while an ambiguous prior attempt retains its
  exact body, key, and pacing boundary. After provider entry, healthy scans
  coalesce against the bounded four-minute send lease until the attempt settles
  or expires; only then may the persisted incident become healthy.
- Hosted managed-automation reconciliation persists retry generation in the existing workspace checkpoint owner. Only eligible, explicitly retryable failures receive the bounded 30-second, 2-minute, and 10-minute backoff sequence; unclassified or permanent failures are logged without manufacturing another wake, and a later successful pass clears the retry generation.
- Managed automation ownership is exact-seed and route-authority based. Built-in seeds without an explicit scope default to `member`; member seeds run only on personal/direct routes, while `authenticated-group` seeds run only on live non-direct Linq/iMessage or Telegram routes. Group email is excluded. Reconciliation archives every nonterminal wrong-owner built-in record, including paused records, while already archived records and caller-supplied unscoped custom seeds retain their prior behavior. Claimed static built-ins and registered dynamic identities resolve immutable ownership by automation id before lifecycle hooks and revalidate the same owner and live route before provider admission, tools, delivery, and commit; editable tags, slugs, titles, and instructions cannot acquire authority. Permanently retired built-in IDs are not seeds: reconciliation archives matching persisted records and claimed occurrences fail closed before lifecycle or model work. The post-onboarding choice point is the one registered dynamic member identity. Dynamically generated experiment-lifecycle seeds remain on their existing path until their separately coordinated owner exposes an exact resolver. Immutable personal-memory and group-room-model IDs still exclusively select silent maintenance policy and its provider-admission replay barrier.
- The unfinished-onboarding follow-up is one finite daily-local automation with exactly three local-day opportunities, anchored to its original first occurrence and closed at 3:00 PM on day three. Migration recognizes PR 1203's exact one-shot, the older exact recurring fingerprint, and the bounded original legacy fingerprint; it preserves the one-shot's stored occurrence, derives that record's recurring local minute from the occurrence, preserves an existing daily-local minute instead of rehashing another identity, bounds a fresh recurring predecessor from its creation time, archives an established predecessor whose original three-day window already elapsed, and never restarts an old account from the current maintenance time. Conversion first leaves the source as a finite `at` schedule, durably binds that occurrence in canonical runtime state, and only then exposes the daily-local schedule, so a partial write cannot run on the signup day and normal managed reconciliation can finish a staged conversion. Each occurrence reads canonical onboarding authority before provider entry and again before tool, delivery, and commit boundaries. Queue-only delivery carries the automation revision into the existing outbox authority fence, which re-reads onboarding state at external provider entry; completed state makes the intent terminally stale, while unreadable state fails closed with `ASSISTANT_ONBOARDING_AUTHORITY_UNAVAILABLE` and remains retryable only inside the finite window. When an obsolete predecessor intent settles authority-stale, the hosted post-delivery owner re-reads cron status, preserves the resulting retry wake, and suppresses the generic delivery-failure input because the cancellation was intentional. The latest in-turn lifecycle read replaces the occurrence's earlier diagnostic snapshot. Metadata-only hosted logs identify seed, reconciliation action, persisted-versus-missing state source, status and timestamps, schedule window, model decision, delivery outcome, and run outcome without creating a second correctness owner or storing message content.
- Personal memory consolidation and reminder availability are independent: memory remains a nightly model turn, while availability is a deterministic stage of the existing hosted background automation pass. It skips exact-time automations and connected reads when no eligible snapshot is due, processes at most 100 due reminders per pass, derives the fixed seven-day request, rejects incomplete or unsupported provider results, normalizes timestamps, and applies the suffix only when the automation version and exact calendar account binding observed before the read still match. A clean empty read writes an empty timestamp-only snapshot. The pass derives the earliest next refresh from canonical `generatedAt`, makes the snapshot due at 23 hours, and persists that deadline through the existing workspace checkpoint and Temporal timer owner, leaving one hour of headroom before delivery's 24-hour evidence limit without a retry queue, separate scheduler, or second state owner. Foreground conversation admission aborts an in-flight connected-app read through the existing background-maintenance signal; ordinary runtime shutdown remains its fallback. A failed, partial, disconnected, or concurrent refresh leaves canonical instructions unchanged and delivery fail-open. Changing a reminder to an exact-time schedule atomically converts it to fixed delivery and removes its availability source, account, and snapshot. Scheduled delivery uses evidence only for a non-exact-time schedule while the current policy/source/account binding remains exact and the snapshot is canonical, unexpired, and covers an occurrence scheduled within 24 hours of generation. The host strips that data-only suffix before any provider turn. Disconnect or provider revocation stops successful future refreshes but does not synchronously cancel the current short lease. Policy removal or account replacement invalidates it immediately; a missed first refresh remains pending and delivers normally, while missed later refreshes age out.
- The post-onboarding choice point is installed as one ordinary managed one-shot after answered onboarding. Its original window begins 21 local-calendar days after completion and expires seven days later. Maintenance gives an eligible older member one future same-weekday occurrence instead of dropping all pre-existing completions or sending a late catch-up immediately; once installed, that occurrence remains anchored. Claim and queued delivery revalidate canonical answered-onboarding authority so a successfully read reopened, declined, manual, or replaced completion state cannot send. An unreadable or malformed authority document is availability failure, not revocation: the existing cron or outbox owner retains and retries the same occurrence or intent within its finite window. The restricted provider attempt uses a fresh ephemeral one-shot process with committed session history and preserves the ordinary provider resume state. A current-home Linq correction derives the conversation locator from the canonical route participant lookup key, including email-keyed routes, with member phone identity only as a legacy fallback. The occurrence otherwise uses the ordinary scheduled notification path and its existing retry, outbox, session, and tool owners. A model skip consumes the one-shot normally and never creates a nag loop.
- Closed integration-ingest months compact only in the abortable hosted idle-shutdown lane. Core publishes a verified deterministic gzip before deleting raw bytes, normal readers and amendments stream bounded gzip output, and startup repairs only an independently valid, newline-terminated, byte-identical raw/gzip pair. A wake preserves foreground priority; a 30-second pass budget or ordinary compaction failure leaves any unfinished source intact and does not block checkpointing. Remaining raw months are the next pass's durable worklist, while a non-identical representation pair fails closed without a repair queue or marker.
- The single group newsletter automation reuses canonical cron occurrence state for both delivery modes. Current-chat editions finish through the ordinary conversation outbox and its route retry policy. A scheduled non-direct Telegram occurrence resolves its exact Web-owned route before group tools or model work, persists that authority with the outbox intent, and rechecks it before provider entry. Missing route authority remains retryable; a locally mismatched target fails stale, while live ownership revocation fails permanently without sending. Email editions report the accepted newsletter parent to cron immediately and put it into the same canonical pending-delivery field used by ordinary queued notifications, even when the notification turn later fails; that failure remains on the run record instead of reopening composition. A restart before that cron write derives the parent from the durable occurrence-scoped outbox key before admitting the provider and reconnects the existing intent to the same pending-delivery field. Web marks the parent sent only after durable recipient fanout planning; the existing cron reconciler then settles the occurrence without another model turn, while recipient intents keep the generic outbox retry policy. The runtime appends the current execution contract on every occurrence so legacy saved instructions cannot retain a retired workflow; no migration queue, repair state, or second scheduler exists.
- Direct and authenticated group input share one active-turn lifecycle. Initial and live exact-successor input is capped at 50 messages cumulatively; the first completed assistant response closes new admission while preserving the existing provider-turn key only long enough for an already-started steer to settle, and a rejected steer plus overflow or later input remains durable and pending for the next ordinary turn. Every completed text or media segment is retained for delivery rather than replaced by a group-only latest response. Telegram speaker labels ride the already-durable wake, while Linq labels are an optional fail-soft read after ingress; only that display-name action receives a one-second soft deadline bounded by the configured control timeout, and lookup failure, timeout, or rollout skew must fall back unnamed without blocking or acknowledging conversation work.
- Reviewed Assistant Ask completions enter the existing foreground-causal,
  output-only continuation immediately; they do not wait for the routine idle
  checkpoint or a second wake. The caller Murph may compose from room context,
  but the resulting outbox intent still carries the completion id and expiry.
  Linq and Telegram revalidate the exact completion and disclosure authority
  inside their existing Web-owned messaging-provider-entry checks. If the
  authority expires or changes after queueing, the outbox first persists the
  fixed text-only fallback and retries that same intent. Route validity alone
  cannot admit a reviewed completion.
- A usage-credit purchase persists one reconstructible `created` purchase before
  Stripe I/O; that row and the single purchase-status lifecycle are the durable
  ambiguity fence. While the purchase is unfulfilled and its provider-final
  `grantSlotReleasedAt` marker is null, it also reserves one future grant slot.
  Local expiry or ambiguous failure does not release that reservation. Exact
  expired-and-unpaid Checkout evidence may release from webhook, explicit
  retrieve/expire, binding, or account-deletion finalization; an exact canceled
  saved-card PaymentIntent may release from its explicit terminal owner. A
  saved-card release fallback, recoverable provider state, and ordinary local
  expiry remain reserved. The migration backfill marks only rows whose durable
  references plus terminal reconciliation prove those same provider-final
  cases, excludes automatic-refill ordinals from reference-free proof, and
  leaves every other historical null-marker row conservatively reserved. Every
  create retry during the first 30 minutes uses the same purchase-derived
  Stripe idempotency key, leaving at least 60 minutes on the frozen Session
  expiry. An ambiguous response must not mint a replacement purchase or create
  a second payable Session. The member may begin another purchase only after
  the existing one is terminal.
- The beneficiary row lock is the sole serialization point for usage-credit
  grants, purchase reservations, debits, projection adjustments, and relevant
  checkout/refill admission. A beneficiary may have at most 32 occupied grant
  slots: positive active grant projections plus unfulfilled purchases whose
  release marker is null. Every capacity inspection reads at most 33 combined
  rows through the partial active-grant and unfulfilled-reservation indexes,
  and the 33rd is a fail-closed invariant violation. Personal, Family,
  and group Checkout purchases, automatic sponsorship refills, explicit
  recovery reacquisition, and unreserved referral grants share this contract
  under beneficiary-before-distinct-payer lock order. Exact replay does not
  reserve twice. Ordinary automatic refill admission returns no refill at
  capacity; overflow fails as an invariant. Recovery reacquires capacity before
  clearing a prior release, and fulfillment at 32 may only replace the exact
  purchase reservation with its active grant.
- Refund and dispute adjustment convergence performs one final shared capacity
  read after its negative and positive passes. If restoration would leave more
  than 32 active grant projections, the whole transition rolls back before the
  Stripe receipt binds and remains retryable; no transient intermediate pass is
  accepted as the final contract.
- A genuinely new personal, Family, or group checkout at capacity returns the
  structured `HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT` 409. Exact request-key and
  matching active-purchase replay resolve first, while true eligibility failures
  remain 403. Group checkout performs its first serialized capacity admission
  before Customer preparation and revalidates afterward so an already-full
  beneficiary does not create provider state.
- Current-policy personal, Family, and group funding may create one unconfirmed
  saved-card PaymentIntent with a purchase-derived idempotency key. Frozen v2
  purchases retain the legacy selection behavior for groups only, frozen v3
  purchases retain it for all targets, and v1 remains Checkout-only. Current
  policy binds personal and Family selection to the exact Murph billing
  Subscription whose Customer matches the frozen purchase, using its attached
  explicit default or its inherited attached Customer default. Missing, stale,
  terminal, customer-mismatched, unattached, or legacy Source-only
  exact-subscription state remains in Checkout, and unrelated Subscriptions
  never participate. Group funding has no required billing Subscription and
  may use the attached Customer default or the only attached method only when
  no legacy Customer default Source exists; multiple non-default methods remain
  in Checkout.
  `allow_redisplay` affects Checkout presentation rather than direct
  chargeability. Current-policy Checkout exposes Stripe's explicit save choice;
  older policy requests remain byte-for-byte reconstructible.
  The producer must bind its encrypted exact reference under the payer lock
  before confirmation. For personal and Family v4 attempts, that locked bind
  also re-reads the current persisted billing Customer, Subscription, canonical
  billing status, suspension state, and last accepted Stripe-event time. A
  billing change, suspension, deletion, or terminal transition that wins first
  leaves the intent unbound, canceled, and never confirmed. Once bound, retries
  remain tied to that exact intent rather than retargeting after a later billing
  change. A succeeded or processing
  event for an unbound intent remains in the existing Stripe receipt retry lane
  instead of being acknowledged without a grant.
  Confirmation and cancellation use separate stable keys. An ambiguous
  confirmation keeps the purchase `payment_pending`; exact request replay
  retrieves and continues only that intent. A fresh request for the same
  target may recover a nonterminal purchase only when its offer matches the
  frozen offer. A different amount receives only the frozen purchase's status
  and cancellation capability. After any unparsed selection response, the
  browser may reuse that request key only through the same endpoint's
  recovery-only mode. Under the payer lock, that mode can continue an exact-key
  purchase or the current matching nonterminal purchase, but it cannot create a
  purchase. When neither exists, it returns a miss before Stripe I/O and clears
  the visible selection to an unselected picker while retaining the unresolved
  request key in payer-and-target-scoped browser session storage. Web derives
  the payer scope from the authenticated server session, stores and verifies
  that key before the first create-capable request, hydrates it before enabling
  a remounted picker, and keeps it through timeout, dismissal, reload, account
  switching, and recovery miss. The next explicit Add action by that payer
  reuses that key in normal create-capable mode. Another payer in the same tab
  receives an independent slot and cannot read or clear it. The payer lock and
  request-key uniqueness then serialize the key with any delayed original
  request: one purchase wins, and a changed offer receives only that winning
  purchase's status/cancel-only projection. Only a durable purchase response
  that proves the submitted selection key matched for that payer clears the
  stored key; mounting an active or return projection, retrying a projected
  purchase, or recovering another request cannot release it.
  A group purchase that can still start or continue payment also requires the
  submitted sponsorship digest to match the frozen draft. Once that exact-key
  purchase is terminal, a remounted or changed draft cannot alter it and must
  not turn durable recovery into a permanent 409 loop: Web returns the frozen
  nonpayable purchase, marks the sponsorship selection conflict, and
  acknowledges the key match. An effectively expired `created` purchase is
  closed through the existing expiry owner before that projection.
  Unavailable storage fails closed before request entry; the winning purchase
  remains the only payable path.
  Authentication or card failure
  may fall back to Checkout only after the exact intent is verified canceled
  and its binding is cleared under the same reconciliation fence. Direct
  PaymentIntent events reuse the existing Stripe receipt and financial
  reconciliation owner rather than adding a retry queue.
- Capped group sponsorship extends that same reliability owner rather than
  adding a subscription, scheduler, queue, or balance. Low-capacity settlement
  admits at most one deterministic $5 purchase while the beneficiary row is
  locked. Its id is derived from authorization, anchored period, and ordinal;
  fulfilled plus nonterminal purchases consume cap headroom. The existing
  minute Stripe sweep performs post-commit provider work, and the verified
  Stripe-event receipt remains the only grant and continuation authority. The
  beneficiary-locked admission is the linearization point for need and cap
  headroom; its deterministic purchase is the durable exact-$5 reservation.
  The sweep rechecks authorization, period, cap, purchase identity, and runtime
  access without holding a database transaction across provider I/O or
  reinterpreting need after admission. Unused granted credit carries forward.
  Safe no-card or authentication-required outcomes terminalize the exact
  purchase, move the authorization to `recovery_required`, and stop later
  admissions without delaying the ordinary reply. Payer recovery reuses that
  failed purchase only if its exact $5 still fits under the current cap; a cap
  reduced to fulfilled spend leaves the failure immutable and reactivates
  without provider work. Provider ambiguity retains the same purchase for
  bounded retry/reconciliation. Lazy month rollover never expires ledger
  credit, never clears recovery, and applies a deferred cap decrease only at
  the next anchored boundary. Activation owns the sole public sponsorship
  moment; refill fulfillment is silent and private notices are period-deduped.
  Payment authority rechecks the current payer suspension fence immediately
  before a bound automatic refill can be confirmed. Payer-owned cancellation
  remains available even when the beneficiary is inactive or the live funding
  projection is otherwise unavailable; the page exposes no retry, cap, or new
  payment capability in that management-only state.
- The Vercel predeploy migration replaces the detached-payer checks before the
  saved-card producer can serve traffic. That replacement is backward
  compatible with the old application, retains the PaymentIntent/Charge and
  ciphertext-clearing invariants, and removes only the impossible
  Checkout-Session requirement for fulfilled direct payments plus the payer
  requirement for a terminal, unbound automatic-refill failure whose exact
  sponsorship authorization and positive charge ordinal remain durable. The
  superseded
  postdeploy constraint installer stays out of the contract-migration run so a
  later workflow cannot re-tighten the schema after promotion.
- The payer-owned cancel endpoint also owns a sessionless direct
  `payment_pending` purchase. It retrieves and cancels only the exact bound
  intent, preserves succeeded or processing state for webhook settlement, and
  terminalizes only provider-proven cancellation. Cancellation is payer
  authority and remains available from Settings or another target's conflict
  state; retry and confirmation remain exact-target capabilities.
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
  resume. Duplicate Checkout, PaymentIntent, and webhook delivery must converge
  on the same purchase, grant, and recheck outcome. Provider/KMS preparation and the full
  database-plus-Temporal recheck handoff are hard-bounded below the derived
  receipt lease, and receipt completion must win its exact attempt fence; a
  timed-out or reclaimed worker remains retryable and cannot report completion.
- Purchase and referral credit share one immutable credit-entry ledger. Each
  positive entry owns one entry-keyed remaining-capacity projection. Settlement
  holds the beneficiary lock, inspects at most 33 positive grants, and rejects
  more than the reviewed maximum of 32 before mutation. One data-modifying SQL
  statement computes FIFO allocations with window sums, updates affected grant
  and purchase projections set-wise, updates the beneficiary projection once,
  and inserts every debit entry. Replay reads at most 33 debit rows and rejects
  more than 32 before its bounded validation loop. The purchase remaining field
  is only a synchronized expand-phase projection. Refund and
  dispute reconciliation requires a purchase-backed entry and cannot touch a
  referral-backed entry. Referral observation stays inside the canonical
  provider-ingress transaction without acquiring the beneficiary lock.
  Arming reserves both rolling caps under referrer plus stable-order
  beneficiary locks, counting recent rewards, nonexpired armed commitments,
  and bound commitments through a 25-hour late-evidence grace. Every arming,
  cancellation, qualification, reward-reconciliation, and celebration-queue
  transaction-client read or write is issued sequentially because Prisma
  interactive transactions own one database connection. Referral response
  projections, including personal usage status, run only on the root client
  after arm/cancel commits. Snapshot and rolling-cap database reads issue one
  root-client operation at a time, and celebration preparation invokes its
  destination, model, and preference projections sequentially. The referral
  owner therefore does not multiply connection demand by overlapping
  independent root-client work. These projections never run inside the
  lock-holding referral transaction or start a nested transaction there.
  Qualification records a pre-expiry durable fence with its evidence;
  post-commit reconciliation rechecks the frozen policy but cannot reject that
  qualified commitment because processing ran after expiry or another mission
  armed. A post-expiry event does not terminate the row during that grace, so
  pre-expiry provider evidence delivered later can still qualify; the first
  referrer-serialized expiry boundary after the grace is authoritative
  finality. The immediate ingress handoff for conversational referrals and a
  bounded Vercel-authenticated minute recovery pass both retry idempotent
  reward reconciliation. For stable signup-link activations, that recovery
  pass is the normal settlement owner and scans oldest first in a fixed 50-row
  batch; no immediate activation handoff exists. The source mailbox append and
  its completion fence commit atomically after reward commit. Group appends
  carry live thread authority;
  personal appends revalidate the frozen blinded source conversation and never
  drift to another preferred channel. Personal Linq appends use an explicit
  fixed target, so provider entry rejects source-route loss instead of applying
  current-home fallback. Durable mailbox reconciliation owns a missed wake, so
  stale route, append, or signal failure cannot reverse or duplicate earned
  credit. Referral production is disabled through the expand deployment and
  prior-function drain. The normal forward migration replaces the amount and
  source checks in one bounded metadata transaction, commits that unavoidable
  brief exclusive lock before validating retained rows, and enforces the new
  referral shape immediately through `NOT VALID` constraints. The post-drain
  contract migration then resynchronizes purchase projections without another
  constraint replacement. Only after both boundaries may Web enable referral
  arming, binding, and observation.
- A fulfilled group purchase may materialize one optional social effect after
  the grant commits. The purchase id owns mailbox deduplication, so Checkout,
  PaymentIntent, and webhook replay converge on one creative notification.
  Failure to activate or queue the moment keeps the Stripe receipt retryable
  but cannot roll back or duplicate the grant. An existing mailbox item is
  re-signaled rather than regenerated. The creative turn adds no reservation,
  attempt counter, or media-specific retry state: the prompt tells the model to
  make one short original song with one `generate_song` call, and a provider
  failure terminally skips this optional effect instead of regenerating it.
  Once a delivery intent commits, the ordinary outbox owns retry and
  deduplication. Running bits need no timer or cleanup job: Web reads
  only fulfilled rows whose `expiresAt` is still in the future, and the
  Assistant rechecks expiry before prompt construction.
- Group payment recovery compares and resubmits the effective authorized
  sponsor draft. Its digest never represents customization that authorization
  discarded. An unreadable encrypted draft fails closed before the UI can offer
  a retry, while an intentionally empty draft remains visible and replayable.
- Matching usage-credit refund or dispute events must never fall through to the
  subscription suspension path. Live re-fetch plus the same beneficiary lock
  must append replay-safe, capped signed `refund_adjustment` or
  `dispute_adjustment` entries as live financial exposure moves. Negative
  entries revoke unused credit and positive entries restore only credit that
  was previously revoked. A failure keeps the Stripe receipt retryable; it does
  not silently complete the event.
- Subscription refund and dispute reversals keep event freshness, the billing
  cursor, unpaid status, and suspension in the same locked billing owner.
  Subscription, latest-invoice, and invoice-payment evidence is prepared before
  that owner lock. The transaction re-resolves the reversal owner and checks
  that the prepared Subscription is still the member's current durable
  identity before applying only the database transition; it never waits on a
  Stripe request.
  Exact replay may repeat that atomic transition, but an already-suspended
  snapshot cannot substitute for event freshness: a distinct newer reversal
  must advance the cursor so an older restore cannot reactivate the member.
  Only a suspension whose unpaid state and cursor timestamp still match may be
  advanced or restored; any other suspension remains the account-deletion
  fence.
- Read-only Labs discovery has no automatic provider retry, background refresh, or stale cache fallback. Web applies explicit time, response-byte, result-count, and location-fanout bounds and propagates caller cancellation. A Junction timeout, rate limit, or server failure is `temporarily_unavailable`; it must not be collapsed into an empty catalog or `not_served`. Only a clean provider response that reports no ZIP coverage is `not_served`.
- Labs capability rollout is additive and fail-closed. Deploy Web's signed callback and provider configuration before Cloudflare/runtime registration; a missing or incompatible route surfaces as unavailable rather than falling back to a copied catalog. Roll back the runtime capability before removing the Web route. Because the feature has no DB, cache, queue, or retry owner, recovery is a later member-initiated live request.
- Definite assistant outbox delivery failures may run at most 48 persisted dispatch attempts. A definite failure on attempt 48 terminalizes as `ASSISTANT_DELIVERY_RETRY_EXHAUSTED`, and no 49th provider call begins; newsletter parent and recipient intents use that same terminal lifecycle and never reset the budget with a new token. A delivery that may already have succeeded is not exhausted as an ordinary failure: hosted non-idempotent confirmation remains parked without an automatic wake, while replay-safe delivery checks persisted or provider reconciliation evidence before terminalization.
- A canonical pending or retryable signup welcome is obsolete once durable auto-reply provenance proves a newer accepted reply for the same recipient route. Hosted collection must abandon that welcome before provider dispatch; a `sending` welcome remains under the normal delivery-confirmation contract rather than being hidden mid-flight.
- Accepted canonical Linq signup welcomes require a completed delivery-outcome callback even when they answer no conversation mailbox item. Web records acceptance and materializes the provider's direct chat in one transaction under existing route ownership locks; callback failure is a may-have-succeeded delivery, and replay relies on the canonical provider idempotency key instead of issuing an ordinary duplicate send.
- Assistant Ask uses `assistant.ask.requested` and
  `assistant.ask.completed` in the existing encrypted mailbox as its only
  durable queue and operation state. Stable request and completion identities
  make exact replay idempotent and keep the first committed answer. Retries stay
  pinned to the original target and membership generation; expiry is the
  existing ten-minute mailbox deadline, with no second lease, timer, status
  row, or delivery ledger.
- Cloudflare may exact-replay one Assistant Ask control request within the
  original request deadline after a replay-safe transport ambiguity or HTTP
  `5xx`. This applies only to group `ask`, `ask_member`, `ask_current_sender`,
  and the dedicated `prepare` / `complete` control requests, whose stable
  identities make identical replay idempotent. Caller cancellation, exhausted
  deadlines, authority failures, and other `4xx` responses do not replay.
- Assistant Ask request and completion appends first signal the existing Temporal
  workflow, then may issue the shared payloadless, no-retry direct
  `ensure-processing` latency hint. Temporal acceptance failure starts no direct
  wake. A dirty runtime admits the exact joined-group request and every
  accepted-input completion through the pre-checkpoint-safe system prefix;
  consented-member requests remain checkpoint-gated. Completion ordering uses
  the existing pending-input occurrence proof, and incomplete or invalid index
  evidence rejects the shortcut without repairing state.
- Hosted R2 reads, writes, direct-upload presigns, cold restores, and lifecycle
  application use one canonical production bucket in ENAM. Account deletion
  clears and re-lists that bucket before Durable Object state is removed; any
  failure retains retry ownership. Deploy preflight requires the canonical
  runtime and preview buckets to be ENAM Standard. Runtime code has no fallback
  bucket, migration phase, or storage-specific admission gate; ordinary retry
  and mailbox durability remain the failure boundary.
- One-time current-sender Assistant Ask reuses the same mailbox lifecycle,
  deterministic request identity, ten-minute expiry, isolated reviewed
  personal read, completion append, and exact-origin group delivery. Exact
  replay reopens and revalidates the stored group input; changed identity,
  question, permission, target, route, or expiry becomes unavailable rather
  than creating replacement work. It adds no scheduler, callback wait, status
  row, grant row, retry owner, or delivery ledger.
- The same dirty-runtime prefix admits only two server-identified,
  replay-safe external-completion notification families:
  `assistant.notification.requested:phone-call-result:*` and
  `assistant.notification.requested:usage-referral-reward:*`. Their stable
  mailbox identity and idempotent delivery let them interrupt the idle floor;
  the foreground-causal selector rechecks those exact dedupe-key families,
  carries only the just-created causal outbox intent into the existing
  write-ahead provider drain, and leaves generic notifications or unrelated
  pending outbox work checkpoint-gated. Fresh conversation input retains
  priority. Referral recovery also re-signals bounded oldest unconsumed
  celebration items, so a post-commit signal failure remains recoverable from
  the existing mailbox without another queue or state machine.
- A legacy joined-group `cannot_answer` queues the fixed
  unavailable-evidence response exactly. It must not start a private provider
  continuation that can invent an expiry, provider failure, or execution
  failure.
- The inbound message-content deadline does not cancel accepted work invisibly. Before local content retirement, the pending-input owner writes the existing terminal suppression evidence for any still-nonterminal input; the next successful idle checkpoint carries that exact mailbox item id until Web stamps the row and advances only the contiguous conversation floor. An unimported expired conversation row is terminalized in place by Web as `policy_non_reply.content_expired`, with payload ciphertext cleared in the same retention statement. Content retirement and checkpoint retries are idempotent, future deadlines share the existing `inbox_media_retention` wake, interrupted bounded passes retry, and an exact preselection sweep prevents a restored overdue input from starting a reply.
- Transcript rollout is two-phase because ordinary snapshot cleanup deletes settled accepted-turn journals before content retention runs. Phase one deploys the stamping-capable runner with immediate rollout, proves fleet convergence, and then re-arms every persisted snapshot once. That rearm advances the existing workspace CAS version while leaving checkpoint time unchanged: pre-rearm runtime checkpoints conflict instead of clearing the new wake, and ambiguous runtime recovery accepts progress only when both version and checkpoint time advanced. The existing hourly cron signals five snapshots per successful run, and each restored runtime scrubs every receipt-backed carrier while preserving legacy unstamped transcript entries. Before migration, compare the aggregate persisted-snapshot count and failure allowance with that capacity; if the queue cannot drain safely, stop rather than inventing a second dispatcher during the retention release. Record the convergence instant, and do not declare phase one complete until the due queue reaches zero. Phase two may begin only after 14 complete days and phase-one drain completion: a separate migration re-arms the snapshots again, and the runtime may then retire every remaining unstamped user entry without reconstructing receipt state. Do not collapse the interval, infer a receipt from projection time, or add a second receipt index.
- Assistant-generated image retirement reuses that same `inbox_media_retention` wake and hourly bounded dispatcher. Every hosted private generated-image path uses the workspace runner's existing capture-persistence boundary or fails closed; the generated-image owner materializes the shared lookup before reading it, and each successful capture write merges its exact 14-day cutoff into the same canonical receipt checkpoint, keeping the earliest cutoff even through shutdown. Deploy and prove the retention-capable runner before applying `20260805010000_rearm_generated_image_capture_retention`; the migration advances each persisted workspace CAS version without changing checkpoint time, clears the prior signal-attempt marker, and re-arms dormant snapshots once. The runtime lazily materializes the lookup and due raw artifacts, commits each image/manifest/event/lookup transition through the hosted canonical-write boundary, and lets valid captures progress when another capture is damaged. Guarded replacement receipts carry raw authority and the inspected preimage; restore materializes lazy receipt targets, treats the tombstone as idempotent, and rejects a third byte state. The rollout is incomplete until the existing due queue drains to zero; do not add another scheduler or migration-owned cursor.
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
- Automatic meal-photo enrollment ordering is replay-safe through one Web-owned per-installation revision high-water mark. A schema-v2 disable persists a tombstone even when its earlier enable has not arrived; delayed or duplicate enables cannot rotate credentials or clear that tombstone, an exact disabled-revision replay succeeds without mutation, and only a higher explicit enable restores authority. Schema-v2 enable is prepared before it is active: a credential response is not upload authority until the foreground iOS app durably saves it and an exact bodyless scoped activation commits. Lost responses and delayed prepares therefore remain inactive. Activation replay is idempotent, and activation/deletion use the same member lock plus exact-token reread so deletion wins in either serialization order. Activation also locks active Family membership and group access rows before its authority read; Family billing locks its owner and active roster members in stable order before changing those rows, so sponsor removal or group access loss either commits first and makes activation fail or waits behind a valid activation without a member-to-group deadlock. Schema-v1 behavior remains immediately active only while the row is at revision zero. Automatic meal-photo uploads are replay-safe only through the capture id derived by the enrolled installation. Each staging attempt must own a distinct object. Under the per-capture mailbox lock, the first accepted item chooses the canonical object for exact duplicates; later attempts delete only their own losing object. Failed or ambiguous appends must reconcile the mailbox claim before cleanup so they never delete an accepted object's bytes. Web must reject conflicting reuse, re-signal exact mailbox duplicates, lock the hosted member and active sponsorship source rows before rechecking final upload authority, and acknowledge an upload only after private object staging and canonical mailbox append both succeed. Runtime import must check the canonical external reference before writing, verify staged length and SHA-256 before import, and delete staging only through a post-checkpoint effect; cleanup derives the user-namespaced object path without requiring encryption-context rediscovery. After failed cleanup, the R2 lifecycle rule makes staging eligible for asynchronous deletion at 31 days, one day beyond mailbox recovery retention, rather than guaranteeing deletion at that exact age. A missing control client, staged object, write fence, mailbox append, or runtime read is a visible retryable failure rather than a successful setup/upload.
- Environment voice upload uses the same single-owner staging pattern without becoming a messaging flow. The authenticated Web route validates origin, active membership, allowlisted audio container signature, byte cap, capture hash, and rejects only invalid or materially future capture times before staging; an old capture time is metadata and must not prevent a first-seen retry after an interrupted upload. A first-seen capture must pass the existing read-first AI-usage gate. Under the member lock, Web admits at most one unconsumed Environment recording per member, while an exact capture retry bypasses those new-work gates and resolves to the existing canonical claim. Each attempt owns a distinct application-encrypted R2 object; the per-capture mailbox claim selects one canonical object and cleanup deletes only a losing attempt. Runtime verifies the canonical byte count and SHA-256, then forces audio through ffmpeg with a three-minute output cap before transcription instead of trusting caller duration metadata. It then runs one Habitat-only silent maintenance turn. Processing failure leaves the mailbox item and staged bytes retryable. Successful fact extraction records audio deletion as a post-checkpoint effect, so audio is never deleted before the mutated vault is durable; deletion failure retains that effect for retry. The 24-hour lifecycle rule is an asynchronous recovery backstop, not proof that deletion happened at the exact deadline.
- Automatic meal import is complete only after the stable 9pm managed automation exists. Capture enrollment and upload require a current active private route, including a verified email fallback, which Web includes in the private mailbox envelope. The import writes the canonical meal first, then idempotently ensures that automation from the envelope route; if the upsert fails, the mailbox item stays retryable. Direct email delivery replaces the saved address with the current verified address through the existing signed Web-control boundary before every provider call, and fails closed when Web no longer returns one. Reconciliation evaluates engagement and AI usage for runnable model work even when system lag is present, while blocked model work can still admit deterministic import-only processing. System-only import must checkpoint the generic cron projection from the mutated vault before running post-checkpoint staging cleanup; a projection read failure leaves the import uncheckpointed for retry. An accepted meal capture is member-wide engagement under the existing 28-day automation policy, so ordinary due automations may resume; it does not bypass AI-usage authorization. Authorized fresh conversation owns the ordinary foreground pass so a retryable system item cannot starve it. A same-workspace retry finds the existing meal, while a retry from the last checkpoint safely repeats the deterministic canonical write before ensuring the missing postcondition. The automation uses the ordinary cron planner and delivery path. `meal closeout-work` derives one bounded batch directly from canonical meals: same-occurrence removal revisions first, then the oldest retained automatic-capture photos. The photos remain the only pending-work queue, so old captures eventually drain without a cursor or another state store. If the provider fails after cleanup begins, a photo-removal revision recorded at or after the scheduled occurrence instant remains evidence only for that occurrence's retry; remaining photos and those revisions reconstruct partial work, while a later occurrence cannot resend the completed one. Photo cleanup is a canonical, idempotent meal mutation that fails closed on changed bytes, mismatched manifest ownership, ordinary meal photos, or partial writes.
- Daily nutrition response cards remain one outbox-owned immutable effect. The runtime retains the V1 parser for existing outbox and checkpoint state, while V2 adds canonical fiber plus nullable goal snapshots. Ordinary private-direct interactive turns, exact private-direct scheduled turns, and the managed meal closeout use the same attachment tool. Scheduled use requires saved instructions that explicitly request a card; occurrence authority alone is not intent. Because a card replaces the whole final response, it is eligible only when the card alone completely satisfies the current request. New accepted input in the same live turn invalidates an earlier card-only decision, and attachment is rejected after the delivery context advances. Every card copies each total from the immediately preceding single-date canonical meal-totals read. It may copy a target only after a bounded active-goal read proves a complete result with exactly one qualifying record for that daily metric and unit; a saturated result, zero matches, or multiple matches leaves the target null. Missing or partial totals can carry only an `unavailable` status, and an assessed status must not point opposite the frozen total and target. The semantic target status is frozen presentation context for the one message, not durable goal progress and not a threshold recomputed by iOS. Linq explicitly requests the shipping Messages extension's interactive balloon. Recipients without that extension, including Messages on macOS, receive a provider static layout whose generated image mirrors the compact SwiftUI balloon's default calorie-ring and one-row nutrient composition. The bitmap is rectangular and badge-free so the provider owns the outer mask. The installed extension retains its native icon and interactive identity, while the provider request omits the optional App Store id so app-absent static cards do not substitute square artwork into the wider Messages icon slot. The static image intentionally omits the native tap-to-reveal target state; its visible native caption preserves only the date and meal count instead of repeating totals or target amounts. A short subcaption appears only when some totals are partial or a non-null assessed V2 goal needs its directional status preserved; null and unavailable goals remain absent. The value-free provider message-body fallback keeps private nutrition values out of lock-screen and notification text, names the text-recovery action, and avoids Apple data detectors that can downgrade the card. The HTTPS message URL carries the immutable V1 or V2 snapshot in the existing bounded Base64URL fragment family for offline extension rendering; the queryless image path carries the same bounded presentation envelope to a stateless Vercel `ImageResponse` route for Linq rehosting. Encoding is not encryption, and neither representation may contain member identity, a canonical record reference, credential, or other authority. The route performs no database or remote read, rejects invalid input before asset reads, emits no application log or analytics event, and returns private no-store/no-index headers. Deploy the compatible iOS reader first, the Web image route second, and the runtime producer last; the Web route must remain available while any sent static image URL may still be fetched. Interactive rollout requires production-device proof because provider acceptance and delivery receipts do not prove the extension draw, provider-owned static composition, image-failure result, or VoiceOver output. After the first V2 card-bearing state or effect, the V2-capable Worker and runner are the rollback floor.
- For Murph's managed goal-aware daily-nutrition workflow, nullable goal snapshots remain replay/rendering compatibility only, not permission to attach an incomplete new card. Before deriving, saving, or surfacing numeric targets, activating a paused proposal, or attaching a card—even when accepted active goals exist or a scheduled closeout requested the card—the assistant reads the complete canonical memory document, the complete bounded active-condition and active-regimen sets plus every returned detail, the bounded lifetime procedure-event and encounter sets plus required details, and the required bounded measurement and test-event evidence. Failed, unreadable, saturated, or safety-incomplete discovery fails closed with ordinary non-numeric text, no Goal or measurement mutation, and no card; an existing paused proposal stays unchanged. An explicit completed bariatric procedure, a relevant active documented or suspected encounter diagnosis, an explicit positive pregnancy result from either canonical evidence owner, clearly current under-18 age, or number-sensitive preference also suppresses numeric output, while absent or non-current evidence alone does not universally block it. Scheduled authority never permits safety questions or target setup. The workflow separately proves complete active-Goal authority before deciding a metric is missing. After explicit interactive target-setting or card intent, a genuinely missing bundle creates or updates one paused canonical proposal and explains all five provisional values in ordinary text; only a later unambiguous acceptance may recheck safety, activate and read back the proposal, re-read same-date totals, and attach the pending card. Corrections, declines, ambiguous or compound replies, unsafe or incompatible targets, and incomplete or conflicting authority remain text-only.
- The procedure-event safety read uses `event list --kind procedure --limit 200` because post-bariatric context is lifetime history rather than an active condition. Scalar procedure names and statuses remain in list output; missing or truncated decision fields require a detail read for that record. Completed bariatric procedures suppress proposals, Goal activation, and cards, while planned, ordered, cancelled, ambiguous, or unrelated procedures do not prove post-bariatric context. Failure, unreadable output, required-detail failure, or exactly 200 results fails closed before any later numeric effect.
- The encounter-diagnosis safety read uses `event list --kind encounter --limit 200`; each item with nonzero `diagnosesCount` requires an `event show` detail read because encounter diagnoses remain canonical visit-scoped context and need not promote into the condition bank. A safety-relevant active diagnosis with documented or suspected certainty suppresses proposals, Goal activation, and cards. Inactive, resolved, historical, rule-out, ruled-out, and unrelated diagnoses do not prove a current exclusion. Missing or unknown status/certainty on a safety-relevant diagnosis fails closed when current meaning cannot be resolved. List failure, unreadable output, required-detail failure, or exactly 200 results fails closed before any later numeric effect.
- The daily nutrition safety gate's pregnancy-evidence discovery uses both supported canonical owners: the bounded lossless 300-day `pregnancy-test` measurement read and a bounded 300-day canonical `test` event list with detail reads for every returned test. A non-pending pregnancy/hCG test with an explicit positive textual result or unambiguous test-level conclusion suppresses numeric output and wins over negative evidence from either owner in that window. Canonical `resultStatus: unknown` classifies the result rather than source-report lifecycle, so it may qualify only with the same strict identity and explicit text; `pending` never qualifies. Numeric hCG values, abnormal or unknown status alone, and negative, pending, missing, malformed, indeterminate, unrelated, or stale evidence remain unavailable rather than proof of non-pregnancy. List/read/detail failure or any 200-record pregnancy-evidence boundary fails closed before proposal, Goal mutation or activation, totals, or card effects. The separate 45-day BMI/height/weight read retains its existing low-BMI and unresolved-saturation gate.
- Compact-table response cards use the same one-effect delivery and stateless image fallback as nutrition cards. Generic tables encode strict authority-free V3 presentation data; workout tables encode strict authority-free V4 tuples and derive progress only from those workout sets. The provider captions preserve every row and cell, or every workout state, set status, target, and actual value, independently of image availability. Both the native fragment and queryless image URL remain below the provider limit, and invalid image requests fail closed without changing the text fallback. Deploy the compatible V4 native reader first, the shared Web image route second, and the Worker and runner producer last. Keep the Web route available while a sent image URL may be fetched. Once either persisted owner accepts V4, the compatible Worker and runner remain the rollback floor. Static and interactive rollout still require macOS and no-extension iPhone proof, including image failure, accessibility behavior, and absence of App Store fallback artwork.
- Tool-enabled assistant provider turns should disable automatic model retries once local side-effecting tools are in play, so bounded assistant/vault operations are never replayed implicitly by transport-layer retry. Bound tool execution failures should be returned to the model as structured tool results so the model can recover inside the same turn instead of aborting the provider turn.
- Assistant product-feedback capture is available only with current accepted-message authority and accepts at most one in-memory candidate during a successful provider turn. The assistant execution context can only hand that candidate to its hosted invocation synchronously; the existing web-control write remains post-checkpoint and starts only after a current-turn member-channel send succeeds. Scheduled occurrences create no ordinary feedback candidate, staged delivery obligation, or no-reply exception. Feedback never counts as a provider side effect for transport retry safety, and persistence remains best-effort with a two-second maximum deadline, no retry queue, and no user-visible delivery state. The accepted-input-derived idempotency key remains the ambiguity fence when a timed-out write may already have reached Web.
- Exact private support escalation remains the bounded in-turn exception to ordinary post-reply feedback persistence. Under the same member-scoped advisory lock, Web writes the fixed member marker plus the anonymous bounded and sanitized issue Murph wrote in its own words, reads and validates both rows, and ranks the member marker for the three-per-UTC-day alert cap. An eligible provider attempt formats from the first stored issue rather than callback memory and uses the feedback-derived Resend idempotency key, so replay has one stable body even when a later callback supplies different wording; missing, member-linked, unsanitized, still-prefixed, or malformed stored detail fails before email. Later records remain durable without another alert; missing email configuration or provider failure remains visible to the current turn without adding a retry queue or second delivery owner.
- The daily product-feedback digest is an internal read-and-email projection,
  not another feedback or delivery-state owner. The ten-minute cron does no
  work outside the 6pm Eastern hour, derives the prior 6pm-to-6pm window with
  time-zone-aware day boundaries, and renders only the three allowlisted
  product-feedback kinds as fixed labels with truthful per-kind totals from a
  grouped aggregate plus their capture-scrubbed summaries.
  The summary read is bounded independently of row volume by a fixed row cap
  with deterministic ordering, and any kind whose total exceeds its displayed
  summaries appends an explicit per-kind omitted-remainder line instead of
  growing the email or misstating counts. An
  empty window still sends the fixed empty digest, while missing configuration
  fails before the database read so the cron stays observably unhealthy.
  Every same-hour retry reuses the exact window and Eastern day-keyed Resend
  idempotency key, so an ambiguous or transient database/provider failure gets
  later bounded attempts without adding a database claim, cursor, or retry
  queue.
- Exact-message targeting must preserve existing effect owners. Reply selection is side-effect free until normal delivery, while reactions keep the existing `message-reaction` operation and retry policy. The local service re-resolves the accepted input before either effect. For a reaction followed by `finish_without_reply`, the provider's already-recorded reaction patch—not a later mutable eligibility check—defers suppression evidence until the delivery outcome is known. A marked normal message persists `nativeReplyRequested: true` with its provider target, and both fields participate in outbox fingerprinting, equality, dedupe, and retry. Every `---` bubble from one response segment copies that same pair; unmarked automatic replies remain flat. Invalid or stale refs fail as recoverable tool results before any effect. A marked Linq send may not create a replacement direct chat, and a selected Linq voice-only response must fail before sending because the voice-memo endpoint cannot carry the reply target.
- An authenticated non-direct group burst may cross sender and native reply-anchor changes only while exact positive causal succession, room/account/delivery/audience, projection readiness, reaction rules, and the 50-input bound still hold. It remains one provider turn and at most one normal reply, but every admitted input keeps separate sender/ref/text/attachment/reply-context prompt evidence plus separate journaling, checkpoint, answered-mailbox, and terminal evidence. Direct actor/anchor grouping is unchanged. When any Linq input carries an explicit anchor, resolve each explicit anchor independently and do not use the unanchored latest-reply fallback for that compound turn. Missing participant attribution blocks only an exact participant effect, never admission or the normal reply.
- Linq speaker-label resolution is prompt-time, presentation-only work owned by the assistant-runtime reader. Its operation-local memo retains successful labels, explicit valid unnamed results, and fail-soft misses through later live admissions, so an already-seen handle never recontacts Web during the compound operation. One versioned private file at `.runtime/cache/assistant-runtime/group-participant-display-names.json` opportunistically reuses validated profile and owner-shared contact labels for 14 days across ordinary turns and fresh reader or process instances that share the same local workspace. A six-hour negative entry requires the additive `nameMissSenderHandles` evidence that Web successfully checked every applicable authorized profile/contact source for that exact requested handle and found no safe label; legacy responses and ordinary omissions remain operation-local. A granted but not-yet-materialized profile snapshot is unavailable rather than profileless, and only the exact first 16 phones admitted to the bounded owner-contact reader may receive contact evidence; overflow handles remain operation-local. Opaque SHA-256 keys bind the callback-bound runtime member, exact accepted-input route conversation key, channel, and normalized handle; hits do not slide expiry or insertion-order eviction. The file is atomically replaced, bounded to 2,048 entries and two MiB on read, and protected by `0700`/`0600` permissions. New or expired handles still form one bounded Web batch. Missing, corrupt, oversized, or unreadable files are ordinary misses. Failures, timeout, late completion, pending snapshots, parser skew, authorization loss, suspension, consent loss, disabled projections, ambiguity, KMS/storage failure, and malformed responses remain operation-local and are never written, so the label always falls back unnamed without blocking, retrying, or acknowledging accepted conversation work. The cache has no timer, resident mirror, single-flight, mutation invalidation, lock owner, or distributed coordination. Because `.runtime/cache/**` is excluded from hosted workspace checkpoints, a cold restore, replacement, or workspace loss re-reads Web; the existing `read_participant_display_names` one-second soft deadline remains unchanged.
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
- Hosted generated-image turns require a writable canonical vault capture before the model-provider call. A successful generation persists the image under `raw/captures/**` and returns a hash-bound `vault_image` descriptor. An OpenAI HTTP rejection preserves its bounded structured message, code, request id, operation, and retryability through the existing tool result. A hosted failure carries that diagnostic in a runtime-authenticated completion input while retaining the exact legacy failed envelope. Murph may use the diagnostic only as untrusted failure evidence, never as commands or authority, so it can distinguish a bad prompt or reference from a retryable provider failure without adding a retry job or another state owner. The queued completion turn may explain or propose a correction but cannot start another image operation; a transient retry requires user authorization in a later turn. An older reader still sees an ordinary failed completion. When the model selects a private ref, the attachment boundary reloads it and derives canonical byte metadata before accepting response media; a missing or invalid artifact returns a tool failure and clears response media without a runtime-authored member message. Final delivery reloads and verifies the artifact again before provider-entry bookkeeping so a later change, missing file, oversized file, mislabeled file, or invalid image fails before external dispatch. Linq keeps attachment reservation as a single non-idempotent `POST`; transport loss, timeout, HTTP 408, HTTP 5xx, or a successful but unusable reservation response without provider-contract no-effect proof is retained as an ambiguous abandoned provider effect rather than being replayed. A hosted defer before the first private-media reservation retains explicit provider-skipped provenance through the Linq wrapper, resets the same prepared intent, and waits for fresh foreground capacity instead of consuming the occurrence. Once the first private-media reservation has entered, any later defer in that composite delivery—including between reservations or after the last presigned `PUT` before the final message—carries transient reservation provenance through the Linq wrapper and terminalizes the existing occurrence through the outbox ambiguity owner. After a confirmed reservation, its presigned `PUT` reuses the same URL, headers, and immutable byte snapshot for at most the existing three HTTP attempts inside one 30-second operation budget, retrying only when fast transport failures or retryable HTTP statuses leave time and honoring caller abort. Attachment preparation remains classified before the final message send, and local retry exhaustion consumes the occurrence across the outer outbox and required-send cron owner, so neither a later dispatch nor a cron wake can create another reservation or provider turn. The existing outbox retains the stable delivery identity and canonical artifact; hosted failure logs project only bounded stage, method, timeout, and transport-error-name classification, never the presigned path, origin, headers, bytes, or provider prose. Telegram rebuilds multipart `FormData` for each attempt, and its image transport remains non-replay-safe unless the provider documents idempotency. The legacy public upload route returns `410 Gone`, so an older warm runner degrades to its existing text fallback instead of creating a new public object.
- Hosted generated voice memo turns must treat ElevenLabs generation, Linq attachment upload, or Telegram delivery-time generation failures as structured tool or delivery failures. When response media carries a transcript, the existing final channel adapter uses that transcript as the text fallback if audio preparation or delivery fails and reports success only after either audio or fallback text is accepted; it adds no queue or delivery owner. Linq derives the fallback provider-effect identity from the persisted delivery key, or from the attachment identity when no delivery intent exists, so the fallback crosses the existing dispatch fence without reusing the text or native-voice claim. Final Linq and Telegram voice memo sends are not replay-safe unless the provider later documents idempotency for those native voice-message endpoints, so outbox transport idempotency must stay false for voice memo media and retries must follow the confirmation-pending/fail-closed path when the fallback is absent or also fails.
- Linq group-icon PUT acceptance means only that the asynchronous mutation was requested. A completed non-OK HTTP response proves that request was rejected, while a transport exception leaves it unconfirmed because Linq may already have accepted it. The existing provider-event ledger records the subscribed success or failure callback with the private chat correlation, terminal provider timestamp and status, and documented numeric failure code. Missing callbacks remain observable absence rather than inferred success or failure. This diagnostic projection never retries the mutation, wakes the runtime, appends mailbox work, or becomes user-facing group state.
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
- Hosted growth activity history reuses the authenticated daily growth snapshot
  cron and its UTC-date upsert; it has no second scheduler or retry owner. Each
  run computes the completed prior-day and trailing-seven-day distinct-sender
  windows from direct and attributable group messages by durable mailbox receipt
  time, not provider event time. A provider delivery that arrives after capture
  therefore belongs to the open receipt window instead of mutating a closed day.
  A same-date rerun may
  replace the aggregate, but retired group evidence makes the affected value
  null rather than silently freezing or lowering it, and charts retain that gap.
  An activity-query, decrypt, or identity-resolution failure is reported and
  creates null activity only for a first same-date row. A later failed retry
  leaves existing activity fields untouched while still updating the daily
  revenue, member, and message snapshot fields. After that write, the cron
  returns non-success so monitoring exposes the missed activity capture and the
  same authenticated endpoint can be manually rerun for that UTC date; Vercel
  does not retry a failed cron invocation automatically. An ops-page read is an
  additional same-date recovery attempt but is not the cron's retry guarantee.
  A successful attribution pass remains authoritative and may replace unknown
  values or write null when it proves retained sender evidence incomplete.
- Observability writes (logs, latency traces, diagnostics, metrics) must never block user-facing latency: queue or fire-and-forget them off the reply hot path and flush at invocation end, per the `Foreground Reply Critical Path` invariants in `docs/contracts/00-invariants.md`. Only warn/error crash-tail writes may block, bounded by the process exit backstop.
- Chat-affirmation group joins (Linq reaction, Telegram inline button) are
  at-least-once, not exactly-once. The provider-event ledger records that an
  event was *received*, not that it was *applied*, so a redelivered event
  re-runs acceptance. Membership creation is the only non-idempotent step: the
  disclosure path derives its grant id from the affirmation event, but
  `leaveHostedGroupMemberTx` deletes the membership row, so a redelivery that
  lands after a departure can silently rejoin that member. Gating acceptance on
  the ledger's duplicate flag is not the fix: it would drop legitimate joins
  whenever a first attempt failed after the ledger write. Closing this needs a
  consumed-event record written in the same transaction as acceptance; it is
  deliberately deferred until a real occurrence or a broader offer-state change
  justifies the table.

## Scheduled tool parity and replay

Canonical scheduled turns receive composable tools through one exact-occurrence
resolver rather than per-tool cron exceptions. Each owner derives a deterministic
retry key from the exact occurrence and operation without fabricating an assistant
input. Scheduled images run synchronously only when the resolved channel adapter
supports `vault_image`; the planner omits image generation for text-only email so
the provider cannot produce media that delivery would silently discard. Background
image and physical-note continuation stays message-authorized. Existing Web owners
still decide whether a write is saved, unchanged, unavailable, or ambiguous.

Every hosted preference origin participates in one Web-owned field-local
lexicographic order: the trusted source `occurredAt`, then its durable source causal
sequence as a tie-breaker. Accepted inputs use their original conversation row,
scheduled updates use the exact occurrence, and Settings or event updates retain
their existing source metadata. Web appends one preference event containing only the
sparse fields that order approves; an all-stale request appends nothing. Canonical
field pointers retain the winning source sequence, and retention preserves the
referenced structural source row needed to recover its trusted timestamp. The runtime
applies approved events by their own mailbox append sequence. This separates
source-order admission from runtime delivery order: either callback execution order
converges in Web, while runtime retries cannot use an older source sequence to
overwrite a later approved event. Deterministic identities include the occurrence or
accepted input, operation, requested fields, and exact provider tool-call id.
Replaying the same identity with different source metadata or approved bytes fails
retryably; distinct commands in one turn remain distinct. No receipt table, second
preference owner, or repair queue is introduced.
Scheduled Clinical Records calls return a stable authenticated launcher and create no
intent. Their exact occurrence request key enables one bounded replay for retryable
transport failure because the scheduled Web branch is deterministic and non-mutating.
The turn-local owner shares an in-flight or successful request but clears only the
exact rejected promise, allowing a later explicit tool call to retry. Message-authorized
claim creation receives no automatic transport replay. The ordinary 15-minute,
single-use claim begins only when the member opens that exact launcher; transient
creation failure remains retryable, and successful creation stages the claim in the
existing private browser-history owner without exposing it in the visible URL or
replacing unrelated history state. Ordinary product feedback remains
accepted-message-only and scheduled turns create no feedback obligation.

Progress updates are the deliberate exception: queue-only cron work has no active
reader and an ephemeral update could arrive after the final outbox reply. The
planner therefore continues to omit `send_progress_update` while exposing the
durable/final-result tools. Accepted-input personalization retains its existing
message and route checks.
