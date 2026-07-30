# Reliability

Last verified: 2026-07-29

## Current Guardrails

- Keep behavior deterministic and documented as the first modules are added.
- Prefer explicit failure paths and actionable errors over silent fallback behavior.
- Update architecture and verification docs in the same change that introduces new runtime entrypoints.
- Avoid hidden coupling between scripts, docs, and runtime code; document new dependencies in `ARCHITECTURE.md` and `agent-docs/references/testing-ci-map.md`.
- Venice core inference is an all-or-none operator configuration: one Worker
  secret plus fixed Luna/Terra/Sol mappings. Deploy preflight rejects partial
  configuration, and Web keeps Venice hidden and projects OpenAI until the
  Worker/runner deployment has been verified. Missing or invalid mappings,
  unsupported paths/models, malformed JSON, and request bodies above 20 MiB
  fail closed before provider egress. Rollback removes Web exposure first; it
  does not add a queue, repair pass, provider fallback, or second preference
  owner.
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

- The production database-health operator alert is an independent Cloudflare
  singleton so the monitored Postgres database cannot take down its own page
  owner. A five-minute Cron Trigger records one normalized PlanetScale sample
  or classified failure in Durable Object SQLite and prunes history after 30
  days. A two-minute persisted run lease coalesces overlapping cron delivery.
  Concrete unhealthy gauges page immediately; discovery, scrape, parse, or
  required-metric absence must recur on two consecutive runs before paging.
  A newly opened incident or one-shot direct migration admission failure admits
  its exact body and idempotency key in the same synchronous SQLite transaction
  that persists the sample and advances any direct-error counter baseline.
  If another immutable page already owns the single pending-message slot, the
  same transaction advances the sample baseline and accumulates the later
  direct-error count plus latest check time in the existing alert row instead
  of dropping it. An acknowledged older page cannot close the incident while
  that evidence remains. The next run with a free slot atomically promotes the
  accumulated count into one direct-error page, which then follows the ordinary
  attempt fence, health preflight, exact-body retry, and restart contract.
  When a direct error forces admission inside an acknowledged incident's
  closed attempt fence, that pending body contains only the non-replayable
  direct-error evidence; co-occurring replayable gauges remain in the persisted
  sample but cannot become stale pending claims. That exact direct-error page
  owns the next eligible attempt. A replayable condition still unsafe at that
  boundary remains eligible for the following paced recurrence. The same
  one-slot ordering applies in reverse: a later direct-error obligation waits
  behind an older page but cannot be consumed by the counter baseline. This
  explicit prioritization keeps admitted bodies immutable without another
  message queue or delivery lifecycle.
  An acknowledged incident's replayable gauge or monitoring recurrence does
  not admit stale evidence while the attempt fence is closed; once the fence
  opens, a still-unsafe current sample admits the recurrence, while recovery
  closes the incident without another page. An already pending page is
  processed or deferred before a later clean sample can close the incident,
  and only an acknowledged provider response clears it. Provider entry is
  globally fenced by the persisted last-attempt
  timestamp, so neither a new incident, recurrence, retry, nor worker restart
  can attempt Linq more often than once every 30 minutes. The attempt time is
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
  message. Acknowledged recurrences advance the alert
  sequence and choose another fixed opening from current metric evidence.
  Message variation must remain contextual and deterministic, never random
  padding. Database pages intentionally have no quiet hours.
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
- Linq instant start uses the existing planner twice around the existing no-card Pulse-trial owner. The first transaction may create the canonical member, verified inbound phone identity, pending same-line route, and invite, but it neither counts the inbound nor appends the conversation. The invite records the persisted model-source admission event and is the single-owner token for that exact original inbound. Only the transaction whose unique phone-identity insert actually creates a genuinely new member may mint the token; if another inbound wins that identity during classifier latency, the admitted planner re-reads the winner under the shared participant-phone lock, cannot mint a token, and follows the ordinary signup-link path without attaching its event to the winner's invite. While a token remains pending, a different inbound for the inactive member exits retryably before accounting or side effects instead of continuing or canceling the start. Stripe customer/subscription provisioning, the billing write, and activation share the existing member lock; before any Stripe mutation that owner revalidates the exact invite and event, and activation clears the token in the same transaction. Stripe calls use the existing five-second, no-network-retry authority budget. A second ordinary planner pass observes active access, promotes the route, counts the original inbound once, and appends it once. Later inbounds then take the ordinary active-member path. Only a genuinely new billing identity can enter this path; an existing Stripe customer falls back before subscription creation so a saved card cannot silently auto-convert. Any classifier, configuration, route, definitive Stripe, or activation failure falls back to the existing signup-link path, while the single-owner wait remains provider-retryable, without creating a second entitlement, queue, or runtime.

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
  owner. After Stripe creates a session, Checkout creation re-locks the owner
  and returns the URL only after binding that reference; if suspension or
  deletion won, it expires the session instead. Account deletion suspends
  first, re-reads all direct attempts and Family billing owners, expires every
  open session, absorbs an expiry/completion race by canceling the resulting
  subscription, and only then prepares the final customer-cleanup receipt.
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
- The hosted reply-latency operator alert remains one singleton incident owner.
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
- The post-onboarding choice point is installed as one ordinary managed one-shot after answered onboarding. Its original window begins 21 local-calendar days after completion and expires seven days later. Maintenance gives an eligible older member one future same-weekday occurrence instead of dropping all pre-existing completions or sending a late catch-up immediately; once installed, that occurrence remains anchored. Claim and queued delivery revalidate canonical answered-onboarding authority so a successfully read reopened, declined, manual, or replaced completion state cannot send. An unreadable or malformed authority document is availability failure, not revocation: the existing cron or outbox owner retains and retries the same occurrence or intent within its finite window. The restricted provider attempt uses a fresh ephemeral one-shot process with committed session history and preserves the ordinary provider resume state. A current-home Linq correction derives the conversation locator from the canonical route participant lookup key, including email-keyed routes, with member phone identity only as a legacy fallback. The occurrence otherwise uses the ordinary scheduled notification path and its existing retry, outbox, session, and tool owners. A model skip consumes the one-shot normally and never creates a nag loop.
- Closed integration-ingest months compact only in the abortable hosted idle-shutdown lane. Core publishes a verified deterministic gzip before deleting raw bytes, normal readers and amendments stream bounded gzip output, and startup repairs only an independently valid, newline-terminated, byte-identical raw/gzip pair. A wake preserves foreground priority; a 30-second pass budget or ordinary compaction failure leaves any unfinished source intact and does not block checkpointing. Remaining raw months are the next pass's durable worklist, while a non-identical representation pair fails closed without a repair queue or marker.
- The single group newsletter automation reuses canonical cron occurrence state for both delivery modes. Current-chat editions finish through the ordinary conversation outbox and its route retry policy. A scheduled non-direct Telegram occurrence resolves its exact Web-owned route before group tools or model work, persists that authority with the outbox intent, and rechecks it before provider entry. Missing route authority remains retryable; a locally mismatched target fails stale, while live ownership revocation fails permanently without sending. Email editions report the accepted newsletter parent to cron immediately and put it into the same canonical pending-delivery field used by ordinary queued notifications, even when the notification turn later fails; that failure remains on the run record instead of reopening composition. A restart before that cron write derives the parent from the durable occurrence-scoped outbox key before admitting the provider and reconnects the existing intent to the same pending-delivery field. Web marks the parent sent only after durable recipient fanout planning; the existing cron reconciler then settles the occurrence without another model turn, while recipient intents keep the generic outbox retry policy. The runtime appends the current execution contract on every occurrence so legacy saved instructions cannot retain a retired workflow; no migration queue, repair state, or second scheduler exists.
- Direct and authenticated group input share one active-turn lifecycle. Initial and live exact-successor input is capped at 50 messages cumulatively; the first completed assistant response closes new admission while preserving the existing provider-turn key only long enough for an already-started steer to settle, and a rejected steer plus overflow or later input remains durable and pending for the next ordinary turn. Every completed text or media segment is retained for delivery rather than replaced by a group-only latest response. Telegram speaker labels ride the already-durable wake, while Linq labels are an optional fail-soft read after ingress; only that display-name action receives a one-second soft deadline bounded by the configured control timeout, and lookup failure, timeout, or rollout skew must fall back unnamed without blocking or acknowledging conversation work.
- Reviewed Assistant Ask delivery uses the ordinary outbox retry owner. Linq and Telegram revalidate the exact completion and disclosure authority inside their existing Web-owned provider-entry checks. If the authority expires or changes after queueing, the outbox first persists the fixed text-only fallback and retries that same intent; the reviewed answer never enters the provider. Route validity alone cannot admit a reviewed completion.
- A usage-credit purchase persists one reconstructible `created` purchase before
  Stripe I/O; that row and the single purchase-status lifecycle are the durable
  ambiguity fence. Every create retry during the first 30 minutes uses the
  same purchase-derived Stripe idempotency key, leaving at least 60 minutes on
  the frozen Session expiry. An ambiguous response must
  not mint a replacement purchase or create a second payable Session. The
  member may begin another purchase only after the existing one is terminal.
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
- The Vercel predeploy migration replaces the detached-payer checks before the
  saved-card producer can serve traffic. That replacement is backward
  compatible with the old application, retains the PaymentIntent/Charge and
  ciphertext-clearing invariants, and removes only the impossible
  Checkout-Session requirement for fulfilled direct payments. The superseded
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
  positive entry owns one entry-keyed remaining-capacity projection; settlement
  consumes those grants FIFO under the beneficiary member lock. The purchase
  remaining field is only a synchronized expand-phase projection. Refund and
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
  finality. The immediate ingress handoff and a bounded
  Vercel-authenticated minute recovery pass both retry idempotent reward
  reconciliation. The source mailbox append and its completion fence commit
  atomically after reward commit. Group appends carry live thread authority;
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
- Assistant Ask request and completion appends first signal the existing Temporal
  workflow, then may issue the shared payloadless, no-retry direct
  `ensure-processing` latency hint. Temporal acceptance failure starts no direct
  wake. A dirty runtime admits only the exact joined-group request and legacy
  completion shapes through the pre-checkpoint-safe system prefix; consented or
  reviewed shapes remain checkpoint-gated. Completion ordering uses the
  existing pending-input occurrence proof, and incomplete or invalid index
  evidence rejects the shortcut without repairing state.
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
- Detached image generation keeps the dirty runtime on the existing runtime
  wake signal while provider tasks or canonical writes remain unfinished.
  Image readiness and fresh conversation input both interrupt that wait; an
  already-due idle checkpoint must not turn unresolved image work into a
  synchronous retry loop that can starve foreground admission. Completed image
  work that remains queued after an enqueue failure keeps an invocation-local
  retry deadline instead of waiting only for a new wake. Each exhausted
  immediate staging batch sets that deadline once before another batch; fresh
  foreground input may interrupt the wait and reset the shared checkpoint
  debounce, but cannot postpone the image retry. A completed-only retained item
  may cross shutdown or provider handoff only after a final event-stage attempt
  when needed, exact idempotent pending-index registration, and projection of a
  due `assistant` wake. Either persistence failure aborts the checkpoint, so a
  later foreground cursor cannot strand an earlier unindexed completion beyond
  backfill range. On provider handoff, the old invocation checkpoints and
  stops without post-checkpoint consumption; the fresh invocation owns the
  completion. Mixed completed-plus-unfinished work remains blocked until the
  unfinished work drains. If a non-abort foreground mailbox import fails after
  consuming its notification, that exact notification returns to the existing
  signal before failure logging and the watcher hands off, so another watcher
  or runtime pass can retry without a second ingress wake or a hot retry loop.
  The image controller remains the sole work owner.
- Automatic meal-photo uploads are replay-safe only through the capture id derived by the enrolled installation. Each staging attempt must own a distinct object. Under the per-capture mailbox lock, the first accepted item chooses the canonical object for exact duplicates; later attempts delete only their own losing object. Failed or ambiguous appends must reconcile the mailbox claim before cleanup so they never delete an accepted object's bytes. Web must reject conflicting reuse, re-signal exact mailbox duplicates, lock the hosted member and active sponsorship source rows before rechecking final upload authority, and acknowledge an upload only after private object staging and canonical mailbox append both succeed. Runtime import must check the canonical external reference before writing, verify staged length and SHA-256 before import, and delete staging only through a post-checkpoint effect; cleanup derives the user-namespaced object path without requiring encryption-context rediscovery. After failed cleanup, the R2 lifecycle rule makes staging eligible for asynchronous deletion at 31 days, one day beyond mailbox recovery retention, rather than guaranteeing deletion at that exact age. A missing control client, staged object, write fence, mailbox append, or runtime read is a visible retryable failure rather than a successful setup/upload.
- Automatic meal import is complete only after the stable 9pm managed automation exists. Capture enrollment and upload require a current active private route, including a verified email fallback, which Web includes in the private mailbox envelope. The import writes the canonical meal first, then idempotently ensures that automation from the envelope route; if the upsert fails, the mailbox item stays retryable. Direct email delivery replaces the saved address with the current verified address through the existing signed Web-control boundary before every provider call, and fails closed when Web no longer returns one. Reconciliation evaluates engagement and AI usage for runnable model work even when system lag is present, while blocked model work can still admit deterministic import-only processing. System-only import must checkpoint the generic cron projection from the mutated vault before running post-checkpoint staging cleanup; a projection read failure leaves the import uncheckpointed for retry. An accepted meal capture is member-wide engagement under the existing 28-day automation policy, so ordinary due automations may resume; it does not bypass AI-usage authorization. Authorized fresh conversation owns the ordinary foreground pass so a retryable system item cannot starve it. A same-workspace retry finds the existing meal, while a retry from the last checkpoint safely repeats the deterministic canonical write before ensuring the missing postcondition. The automation uses the ordinary cron planner and delivery path. `meal closeout-work` derives one bounded batch directly from canonical meals: same-occurrence removal revisions first, then the oldest retained automatic-capture photos. The photos remain the only pending-work queue, so old captures eventually drain without a cursor or another state store. If the provider fails after cleanup begins, a photo-removal revision recorded at or after the scheduled occurrence instant remains evidence only for that occurrence's retry; remaining photos and those revisions reconstruct partial work, while a later occurrence cannot resend the completed one. Photo cleanup is a canonical, idempotent meal mutation that fails closed on changed bytes, mismatched manifest ownership, ordinary meal photos, or partial writes.
- Tool-enabled assistant provider turns should disable automatic model retries once local side-effecting tools are in play, so bounded assistant/vault operations are never replayed implicitly by transport-layer retry. Bound tool execution failures should be returned to the model as structured tool results so the model can recover inside the same turn instead of aborting the provider turn.
- Assistant product-feedback capture accepts at most one in-memory candidate during a successful provider turn. The assistant execution context can only hand that candidate to its hosted invocation synchronously; the existing web-control write remains at the foreground delivery owner and starts only after a current-turn member-channel send succeeds. Failed provider attempts discard their candidate, invocations without a successful foreground send may abandon it, feedback never counts as a provider side effect for transport retry safety, and persistence remains best-effort with a two-second maximum deadline, no retry queue, and no user-visible delivery state. The accepted-input-derived idempotency key remains the ambiguity fence when a timed-out post-reply write may already have reached Web.
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
- Hosted generated-image turns require a writable canonical vault capture before
  the model-provider call. A successful generation persists the image under
  `raw/captures/**` and returns a hash-bound `vault_image` descriptor. When the
  model selects that private ref, the attachment boundary reloads it and derives
  canonical byte metadata before accepting response media; a missing artifact
  or schema-invalid replacement clears the current media batch and remains a
  recoverable, reply-required tool failure instead of retaining stale media,
  becoming an undeliverable outbox item, or permitting accidental silence. The
  reply requirement remains unresolved for the rest of the turn across later
  steer contexts and successful output tools; neither ordinary
  `finish_without_reply` nor an approved vault-file delivery may replace it.
  Only nonblank provider text owned by the requirement's delivery context
  satisfies it. Otherwise, the finalizer supplies `An attachment couldn't be
  included in this reply.` in delivery and transcript state and routes it
  through the requirement's originating context and selected target.
  Same-context valid media accompanies that recovery; media or text selected
  for a later steered context remains on its own final context and target while
  the recovery is an earlier segment. A model-authored recovery promoted from
  the requirement's context retains its original target and is marked required
  before that later final; absent such text, the neutral recovery sentence is
  used. Output already selected for an intervening delivery context becomes
  another marked predecessor with its own target rather than inheriting the
  latest final target. The explicitly marked final sequence base is
  `<base>:required-before-final`; required predecessors add
  `:segment:<ordinal>` before any bubble suffix and retain their original route
  and native target. Every new marked bubble, segment, and final persists the
  exact preceding intent id, with an explicit root on the first member.
  Predecessor-only groups enforce that chain while the final intent is still
  being constructed. If one provider bubble of a required
  logical segment persists but a later bubble cannot, or a multi-segment
  sequence otherwise loses intent ownership, remaining delivery and the final
  fail closed. The final is
  eligible only after every predecessor is
  `sent` with a non-null
  receipt. Missing, failed, abandoned, sent-without-receipt, or non-idempotent
  confirmation-pending predecessor evidence makes the marked predecessor
  unavailable and blocks the entire active sequence. A missing, quarantined,
  wrong-session, or conflicting linked intent is unavailable without relying
  on the corrupt file's bytes. Any affected member proved never attempted is
  terminal-failed for predecessor unavailability. An
  attempted affected member is reconciliation-only: idempotent transport may
  pace another receipt confirmation but never re-enter provider delivery,
  while non-idempotent transport ends in terminal ambiguity. An
  `awaiting_approval` member remains parked. Terminal ancestors of a marked
  sequence are retained while any linked member remains nonterminal, so
  age/count pruning cannot later release a successor after its failed
  predecessor disappears. The shared assistant-engine resolver groups by
  session and stable sequence base across route and target changes;
  an exact idempotent replay may therefore reuse a persisted predecessor from
  an earlier runtime turn id and still order a newly created final from the
  retry without rewriting immutable receipt ownership. Local queueing, hosted
  collection/wake/preparation/drain, generic engine drain, and locked core
  dispatch all read or revalidate it. This contract applies only to explicitly
  marked recovery sequences and does not redefine ordinary outbox ordering.
  Media alone never replaces the recovery. When an approved vault file
  coexists with that reply requirement, the same final-action patch retains
  vault-file ownership and rejects later response-media tools without hiding
  the recovery text or clearing an explicitly selected reply target.
  Successful approval records the vault-file owner independently of generic
  no-reply eligibility, so earlier visible output is preserved without dropping
  the later media fence. Stateful media and final-action tools apply in request
  order, so receipt of a later request cannot suppress an earlier queued media
  mutation. A response-media result that completes after a steer updates or
  creates a closed segment for the delivery context and selected target
  captured when the tool request was accepted; it cannot merge into or relabel
  the live media batch for the newer input. Progress remains an independently
  delivered visible output: an
  in-flight progress send makes no-reply unavailable instead of being silently
  discarded. Final delivery reloads and verifies the artifact again before
  provider-entry bookkeeping so a post-attachment change, missing file,
  oversized file, mislabeled file, or invalid image fails before external
  dispatch. Linq retries reuse the stable delivery identity while uploading
  through the existing attachment boundary. Telegram rebuilds multipart
  `FormData` for each attempt, and its image transport remains non-replay-safe
  unless the provider documents idempotency. The legacy public upload route
  returns `410 Gone`, so an older warm runner degrades to its existing text
  fallback instead of creating a new public object.
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
