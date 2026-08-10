# Baseline Invariants

This file contains Murph's cross-cutting engineering rules. Product behavior
belongs in product specs. Protocol details, file paths, provider fields,
tunable numeric settings, incident history, and rollout case law belong in
owner docs and executable tests. A fixed numeric floor appears here only when
it has been explicitly elevated to a cross-cutting invariant.

## Admission Test

- A baseline invariant must protect a recurring cross-cutting failure class or
  an irreversible boundary, survive changes to today's mechanism or provider,
  and name an outcome that can be proved.
- Keep owner-specific requirements in owner contracts and tests. Repeated
  incidents trigger first-principles design review, not another automatic rule
  or mechanism.

## Radical Simplicity

- Default to deletion. Before adding code, an abstraction, dependency, service,
  configuration, state, or process, state the current proven requirement and
  show why deletion, reordering, an existing owner, a stable key, or a native
  platform primitive cannot meet it.
- Prefer fewer owners, states, branches, concepts, and hidden transitions. Add
  an abstraction only when it removes real duplication, clarifies ownership
  and data flow, or mechanically enforces a hard invariant.
- When a current feature can be expressed through a smaller generic capability,
  build that capability as a composable primitive at its owning boundary and
  keep the feature as policy or composition over it. Do not add feature-only
  tools, services, state machines, or control paths that duplicate that
  capability. Generalize only as far as proven requirements; this rule does not
  justify a speculative framework.
- Add complexity only for a failing production-faithful test, a measured
  bottleneck, a security or privacy requirement, or a concrete current product
  need. A review finding alone does not justify machinery.
- When successive fixes add state or branches to repair the same mechanism,
  stop patching. Restate the required outcomes and redesign from the smallest
  primitive that satisfies the proven failures.
- Each temporary migration, compatibility path, repair path, or test scaffold
  has one owner and a concrete removal condition.
- Optimize first by deleting work, narrowing dependencies, removing duplicate
  reads, or moving optional work off-path.

## Trust Codex Native Capabilities

- Treat Codex CLI and Codex App Server as the capable execution substrate. If
  Codex owns a capability — process lifecycle, thread continuity and resume,
  steering, streaming and transport fallback, tool use, web search, memory, or
  subagents — Murph integrates it instead of reimplementing or supervising it.
- Keep the Codex adapter thin. Do not add PID sweeps, process classifiers,
  shadow lifecycle or thread and turn state, watchdogs, retry and fallback
  loops, or orchestration that duplicates Codex. Add Murph-side machinery only
  after a measured production gap or production-faithful failing test shows
  native Codex cannot satisfy a named invariant. Do not encode today's model
  limitations as permanent supervision.
- Murph owns the boundary around Codex: accepted-work durability; user, target,
  authorization, and current-turn identity; stale-output rejection and explicit
  abort; privacy; canonical writes; provider credential and delivery authority;
  and irreversible effects. Warm reuse is an optimization, never authority.
- One Codex App Server belongs to the warm container or Node process and stays
  warm across ordinary turns for that owner's lifetime. Starting or completing
  an ordinary turn, closing an ordinary invocation, rotating
  invocation-scoped credentials, or starting a later turn must not replace it.
  Process replacement is limited to owner shutdown, App Server exit or proven
  unhealthy/poisoned state, explicit operator shutdown, explicit workspace
  invocation abort/preemption, or a genuine process-level configuration change
  that Codex cannot accept through thread or turn RPC. Workspace invocation
  abort/preemption must synchronously stop the exact owned App Server before
  the invocation slot can be reused.
- `packages/assistant-engine` is the sole resident App Server process owner.
  Process readiness is a memoized property of that exact process and is
  separate from turn reservation: after the first fresh auto-reply-enabled
  pre-pass Linq or Telegram input candidate is staged, process-only
  initialization may start without reserving a turn, and a matching turn
  synchronously reserves that exact process before joining the same readiness
  work. Email, self-authored Linq, bootstrap, system, maintenance, replay, and
  active-turn imports do not admit preparation. The existing engine-owned
  slot-transition lock serializes inspect, exact teardown, publication or
  reservation, and workspace-boundary admission; initialization readiness itself
  runs outside that lock. Do not add a second warm-slot lifecycle, lock owner,
  startup scheduler, or speculative turn owner.
  Initialization alone is not prior-turn reuse: the first foreground turn keeps
  first-turn request and event scoping until one real turn completes.
- Process-only initialization never starts or resumes a thread, starts a turn,
  invokes provider or account operations, assembles dynamic tools, compacts a
  thread, or launches a child. Failure or cancellation is only a missed
  optimization: it rejects every pending App Server RPC, stops the exact
  process, and leaves accepted work eligible for the ordinary fresh-process
  path. A stale readiness completion from a stopped or replaced process cannot
  publish, clear, reserve, or replace a newer process.
  Speculative preparation never evicts a healthy claimable resident with another
  launch identity; only authoritative foreground acquisition may replace it.
- Prompts, session/thread/turn ids, delivery routes, and invocation-scoped
  automation or device authority are request facts, not App Server launch
  identity or ambient child-process authority. Expose invocation-scoped
  authority only through narrow typed tools on the current root turn; keep it
  out of the App Server and descendant shell environments.
- No user-promised work may be owned only by App Server or descendant process
  memory. Before detaching optional enrichment or skill-authorized bounded
  persistence, the root must have a durable accepted input, canonical fact, or
  raw source and must give the child its exact source words, ids, or refs. A
  loaded skill may assign one independent canonical record family per child;
  every write must be idempotently attributable to that durable source. A
  terminal lifecycle receipt is advisory, and canonical readback confirms the
  write before Murph says it finished.
- A detached Codex MultiAgent V2 child admitted before a root reply may continue
  after that reply only as a one-shot leaf. Hosted configuration admits the
  root plus at most three concurrent children per session. Each child owns one
  independent bounded family and may not interact with the root or another
  child, be reused for another turn, spawn a nested child, or leave a background
  terminal. It never inherits the root turn's
  invocation-scoped automation or device capability. Root completion or a
  later ordinary turn does not terminate valid detached work merely to rotate
  request authority. If the root replies while its child is still generating,
  every later ordinary inbound root turn checks again for completion. A newly
  completed relevant result is incorporated at most once. Use, failure,
  cancellation, or loss of relevance ends that child's rechecks; an unfinished
  child never blocks the current reply and is checked again on the next
  ordinary inbound turn. Scheduled automation, maintenance,
  system-notification, and output-only turns never perform this recheck.
- Before a hosted workspace snapshot, Murph waits for every exact resident child
  and checks every touched root and resident child for background terminals. A
  root's lifecycle set retains every admitted child until that boundary clears;
  completion of one sibling must not evict another. An ordinary checkpoint wake
  interrupts only the boundary wait and preserves the warm App Server plus all
  resident evidence. A timeout or unsupported lifecycle stops the exact process
  and fails closed. Explicit workspace invocation abort/preemption interrupts
  the wait and synchronously tears down that exact process before workspace or
  invocation ownership is released.
- Before checkpoint construction, the runtime closes and joins asynchronous
  preparation admission. Unreserved process initialization that is still
  pending is then cancelled and its exact process is awaited through teardown.
  Invocation release uses the exact-process handle returned by preparation and
  must not cancel a later replacement admitted by another caller.
  The slot owner marks the full checkpoint boundary active, so new resident
  preparation declines and warm foreground or account acquisition begun while
  it is active fails busy instead of queueing a replacement behind the
  boundary. A caller that already obtained a slot-transition ticket retains
  FIFO priority, so the boundary observes that process or fails busy rather
  than overtaking it. The checkpoint holds the existing slot-transition lock
  only through its exact-process check and any pending-preinitialization
  teardown or ready-process reservation. The potentially long background-work
  wait runs outside the lock under that reservation.
  An already-ready idle resident process remains governed by the ordinary warm
  App Server checkpoint contract; preparation does not create another
  checkpoint owner.

## Foreground Reply Critical Path

- A durably accepted current conversation message, or a ready trusted
  completion for work that message already launched, is the runtime's
  highest-priority work. Unfinished detached provider work remains background.
- When an exact generated-image completion and newer conversation input are
  both waiting at the next provider boundary, admit the completion immediately
  before that input in the same frozen batch. Later conversation input may join
  through the existing live foreground loop.
- This ordering is durable rather than wake-owned. A restored background pass
  or a replacement invocation with fresh input derives the same
  completion-first batch from structurally trusted completion events already
  held by the pending-input index; the assistant wake remains a droppable
  scheduling hint.
- Restored completion folding is origin-bounded. Admit only same-route
  conversation events whose canonical cursor is strictly after the trusted
  completion origin. Older same-route backlog and every other route remain
  pending under ordinary batching rules.
- For that exact trusted-completion match, authenticated group-route identity
  comes from the channel, account, thread, directness, actor boundary, and
  delivery target. A provider continuation session is not route identity;
  ordinary non-completion batching still keeps its existing session boundary.
- From durable acceptance through provider start and durable reply handoff,
  await only loading and decrypting the accepted current input, minimal
  current-conversation context, assistant execution, and persistence of the
  minimum delivery-intent state. Do not re-resolve mutable authority or routing
  on this path.
- Projection, enrichment, diagnostics, telemetry, usage accounting, retention,
  compaction, cleanup, device sync, browser refresh, cron, replay catch-up, and
  unrelated mailbox work stay off that path. Keep their static dependency
  closure and initialization off-path too, not only their explicit waits.
- Once current input is durably staged, a rebuildable projection may precede
  assistant admission only when that input needs projection-owned evidence not
  present in the staged input. Projection maintenance, indexing, or dedupe is
  never itself admission authority.
- Signal foreground availability at the earliest durable staging boundary,
  before projection, full import completion, maintenance, or routine
  checkpointing. Typing or activity signals are best-effort and cannot delay
  provider start.
- Background work runs in finite abortable units, checks for fresh input before
  each unit, and derives continuation from durable owner state. Preemption
  defers work; it never drops it.
- A cross-context assistant ask uses paired encrypted mailbox items as its only
  durable work state. Trusted owners derive and revalidate the target,
  membership generation, origin, and return route; model-supplied labels or
  questions never confer authority or select an internal runtime id.
- A detached assistant read may overlap foreground work only in a separate
  one-shot process with OS-enforced read-only roots and no write, tool-network,
  route, delivery, or recursion authority. The resident foreground assistant
  remains the sole model-authored canonical-content writer and sender. The
  runtime must abort, await, and prove exit of the exact owned child before
  checkpoint release, workspace replacement, fence loss, shutdown, or
  invocation return.
- A foreground prerequisite is a named current fact, not a generic lane or
  backlog. Bound unavoidable pre-provider and pre-delivery collections and
  waits, but never let background, replay, maintenance, or diagnostic budgets
  cap fresh accepted input.
- Recovery, replay, audit, checkpoint, projection, maintenance, and diagnostic
  failures may reject unsafe mutation and surface explicit degraded state, but
  cannot indefinitely withhold foreground reply authority from durably accepted
  current input. Continue from the last-known-good authorized state; never
  fabricate or force conflicting canonical state to make recovery appear clean.
- Routine hosted workspace snapshot publication is idle-only and interruptible.
  After the latest durably accepted conversation message, routine checkpoint
  construction has a hard 180-second minimum quiet window. Internal assistant,
  maintenance, retention, cleanup, projection, and scheduled wakes must not
  shorten it. Only the exact assistant retry or follow-up wake projected
  directly by the current foreground assistant phase may run as foreground
  work inside that window without publishing a snapshot. The only other
  exception is a server-identified, fixed-destination exact completion: a
  transport-idempotent phone-call-result or usage-referral-reward notification,
  or a private Assistant Ask completion whose `aask_done_*` identity binds its
  exact text, personal member, current direct route, and expiry. After fresh
  conversation work has priority, the runtime may select only those durable
  mailbox families, compose them queue-only, and persist their causal outbox
  intents before the idle floor. Transport-idempotent delivery may drain in the
  hot pass; non-idempotent provider work remains behind the resulting durable
  checkpoint. Generic notifications and unrelated pending outbox work remain
  excluded. Inherited, committed, durability-gated, and shutdown-time wakes do
  not otherwise use this exception. If the hot pass dirties state, the full
  quiet window starts again. An actual host termination may use the separate
  last-chance durability path, but durably staged foreground work still wins.
  Current-turn durability barriers may run only for facts the current reply or
  effect consumes. Before provider start, that is limited to accepted-input and
  turn-ownership proof; before an irreversible send, to the minimal outbox
  identity and intent needed for replay safety. Unrelated work cannot join.
- Once a reply is ready, optional logging, telemetry, usage flushing, typing
  teardown, cleanup, or reconciliation cannot delay delivery. Attempt-bound
  acceptance, staging, local-turn, first-output, and delivery telemetry is
  content-free, best-effort, and nonblocking.
- Command-level turn telemetry is bounded, content-free, and derived from the
  command owner's structured completion facts. For a batch, retain only an
  allowlisted child command family plus numeric call, duration, output-size,
  and failure aggregates; never persist argv, arguments, queries, paths,
  stdout, parsed output, or error text. If bounded child attribution is
  incomplete, mark it truncated instead of reconstructing private command
  content from shell text.

## Accepted Work And External Effects

- A change must not introduce a new automatic or unsolicited member-facing
  message, notification, nudge, reminder, permission offer, or parallel
  delivery unless that extra message is strictly necessary to the requested
  outcome and the task's user explicitly approves that automatic effect before
  implementation.
  Prefer one already-authorized conversational reply over a second automatic
  effect. Existing authorized automations remain governed by their owning
  consent and lifecycle contracts.
- Every durably accepted conversational input reaches a restart-safe terminal
  disposition: delivered response, explicit policy non-reply, or an explicit
  durable supersession record naming the later accepted input. Accidental
  silence is not terminal.
- When admission changes canonical state that the accepted work requires,
  commit that change and the accepted-work record in one atomic owner
  operation. Optional configuration may add or omit metadata; it cannot gate
  either required write.
- Product, dedupe, revision, and effect identities derive from stable product
  or provider facts. Attempt identities are unique to one attempt. These roles
  remain distinct across retry, replay, overlapping ingestion, restart, reorder,
  resend, and migration re-entry.
- Validate target, configuration, and authority before claiming an irreversible
  effect. Persist the minimum effect identity and intent before the provider
  call.
- Once a non-idempotent provider call may have started, ambiguous failure does
  not release the claim or permit blind resend without provider idempotency or
  proof that the effect did not begin. Acknowledge, clean up, or advance
  progress only after terminal or durable pending evidence.
- Any path that suppresses or defers a user-visible effect records a typed
  durable outcome. A persisted pending effect names its current validity
  predicate and is durably superseded instead of delivered when that predicate
  fails.
- A canonical group-join reaction accepted for reply-gated proactive outreach
  is Web-owned durable work. The eligible phone participant either has no member
  identity or is a verified, unsuspended member without active hosted access who
  is not already in the target group. Active members stay on direct join;
  suspended and existing target-group members are consumed without outreach. The
  stable offer-and-participant identity collapses webhook retry, duplicate
  reaction, and unlike/re-like delivery. Every refusal is typed and durable:
  line health and capacity defer with a bounded next attempt, and a condition
  whose inputs cannot change terminates instead of deferring, so no row retries
  forever and none is dropped unrecorded. Contact data that a reaction creates
  participates in the existing account-deletion and group-deletion owners rather
  than outliving them.

## Authority, Ownership, And State

- Each fact that can change a durable decision has one owning source and one
  resolver. Caches, projections, snapshots, runtime state, aggregates, and
  provider callbacks are accelerators unless the owner contract says otherwise.
- Validate durable authority when an operation crosses a lifetime, target, or
  irreversible-effect boundary. Carry narrow typed proof within that bounded
  operation instead of making sibling layers rediscover it. Model-supplied
  targets are requests, never authority.
- Participant-target phone egress is denied unless its exact send kind has a
  narrow durable authority binding the idempotency key, participant identity,
  and source line. Adding one allowed first-contact kind must not widen another
  kind's assertion or create a generic participant-target bypass.
- Match state lifetime to scope. User-facing or queryable product truth is
  never assistant runtime state and never begins in process, request, turn,
  wake, orchestration, or other operational state. Durable obligations must be
  derivable from owned durable metadata on every pass.
- Canonical vault writes go through the owning canonical API with provenance.
  Importers prepare data; CLIs, assistants, and runtimes call the owner.
  Transcripts, projections, and runtime state are never promoted implicitly.
- Workspace packages use declared public entrypoints and keep dependencies
  one-way and acyclic. Shared behavior moves to the lower owning package instead
  of reaching into sibling internals or creating circular re-exports.
- Provenance-bearing raw evidence and append-only records are immutable by
  default. Repair is an explicit owner primitive with precondition proof and a
  metadata-only audit trail.
- A guard or authority change is complete only when every path to the protected
  effect routes through it durably or is proved unreachable.
- For any storage owner placed under a private-content classification guard,
  every persisted field has an explicit classification: encrypted content,
  keyed lookup, hashed capability, approved operational metadata, or temporary
  legacy debt with one owner and a concrete removal condition. Identifiers,
  state enums, and timestamps qualify as operational metadata only when they do
  not carry private payload content. Owner docs name the guard's exact coverage;
  one guarded model is not proof that every repository store has been audited.
- Newly introduced or materially changed private content is protected before its first durable write and is never
  dual-written to plaintext. Migration readers prefer ciphertext and may use a
  legacy plaintext value only when ciphertext is absent; present empty,
  malformed, or unauthentic ciphertext fails closed. Plaintext cleanup proves
  the replacement value, uses bounded compare-and-set work, and emits no private
  content or storage identifiers.

## Conversation-First Product Control

- A new or materially changed member-facing setting, query, or user-initiated
  product action is complete only when the member can request and complete its
  discrete outcome in a normal supported conversation, then receive a
  trustworthy result or durable confirmation. The assistant reaches the
  capability through an assistant-accessible typed CLI command or headless
  product operation; an otherwise routine outcome cannot require a web page as
  its only control path.
- Web and conversation adapters route through the same canonical owner and its
  applicable validation, authorization, confirmation, and audit rules. Neither
  may create a second mutation owner, source of truth, or surface-specific
  business policy. A command that the production assistant cannot discover or
  invoke does not satisfy this rule.
- If an irreducible step needs another surface, the owning product spec records
  the narrow exception allowed by `agent-docs/PRODUCT_SENSE.md`. Conversation
  still handles every safe surrounding step and the smallest authorized
  handoff. Capability parity does not require reproducing browser presentation
  in chat.
- Conversation access never weakens identity, authentication, consent, privacy,
  recipient, payment, confirmation, or irreversible-effect controls.

## Ordered Progress And Bounded Work

- Cursors, watermarks, sequences, pending-input indexes, and pagination use one
  total, transitive, owner-shared ordering primitive. Import progress is not
  handling progress.
- Explicit owner or provider causal identifiers take precedence over
  positional, "latest," grouping, watermark, and time-window heuristics. Work
  with distinct ordering anchors must not be merged into one turn. A
  provider-native reply target is per-message semantic context, not an ordering
  anchor for an authenticated non-direct group room.
- When one wake exposes a bounded sequence of already-durable, replyable
  messages with exact-successor positive causal identifiers, process as one
  assistant turn either one direct conversation with one actor and native reply
  anchor or one authenticated non-direct provider room with stable route,
  account, audience, projection-readiness, and reaction boundaries. Preserve
  every admitted group message's sender, opaque message reference, content,
  attachments, and native reply context separately. Initial selection freezes
  before provider start. Exact successors may then join through the existing
  live-steering path only until the first completed assistant response; initial
  plus live input is capped at 50 messages, and overflow or later input remains
  pending for the next ordinary turn. Every completed assistant text or media
  segment remains part of the turn and is delivered; no audience-specific
  last-response-wins rule may discard it. A gap, legacy or missing causal
  identifier, changed direct anchor or actor, or changed room boundary starts a
  later turn; terminal evidence covers every admitted input so restart repair
  cannot resend the reply.
- Accepted-turn membership remains authoritative during restart recovery. If
  terminal evidence proves only an oldest contiguous handled prefix while a
  post-freeze successor is also pending, repair and retire exactly that prefix,
  checkpoint at its terminal input, and leave the successor pending for a later
  turn. Recovery never widens the historical turn or advances past an uncovered
  obligation; ambiguous, overlapping, noncontiguous, or conflicting evidence
  fails closed.
- Progress never advances past accepted work without terminal or durable
  pending evidence. A checkpoint cannot make an unhandled obligation disappear.
- Commit durable work before signaling. A wake is a droppable, replayable
  latency hint, never product truth. One owner records the next durable
  decision; consumers do not recreate due or defer policy.
- Any retrying, paging, or open-ended loop has a progress measure and a
  no-progress exit. Every potentially unbounded wait or unit of background work
  has an item, time, or attempt bound plus an abort or durable continuation
  path. Foreground latency must not grow without bound with unrelated history,
  backlog, workspace size, file count, transcripts, or logs.
- Recovery candidate enumeration begins from surviving staged evidence. Clean
  terminal metadata without stage residue is not recovery work. Narrowing that
  enumeration must preserve canonical identity across physical partitions.

## Database Load And Collection Fanout

- A request, render, transaction, or job that consumes a collection has an
  owner-documented upper bound on datastore round trips, decrypted fields,
  external key or provider calls, and concurrency. Evaluate that bound at the
  maximum admitted cardinality. A small connection pool is a capacity limit,
  not backpressure that makes unbounded application fanout safe.
- As output cardinality grows, use narrow set-based reads or explicitly bounded
  pages. Read shared facts once at their owning boundary and derive downstream
  views from that snapshot. Sibling helpers must not reread the same owner rows
  or decrypt fields their caller does not use.
- Fewer reads must not weaken correctness. Keep required live authority checks
  at lifetime, target, and irreversible-effect boundaries. Remove only reads
  proved equivalent, and reuse owner predicates and resolvers instead of
  copying policy into feature-local code.
- Per-item external work that cannot be batched is deduplicated and
  concurrency-capped. Crypto owners batch envelope metadata, preserve binding
  and authenticity checks, fail closed on missing or mismatched material, and
  zeroize key and plaintext buffers on success and failure.
- A database transaction holds one pooled connection for its full duration.
  Never open one transaction per collection item concurrently; batch the items
  into one transaction or process them sequentially, and count concurrent
  transactions against the request's concurrency bound.
- The fanout bound composes across the whole request, render, or job: parallel
  helpers that each fan out internally multiply, so evaluate peak concurrent
  datastore work for the composed path and keep one request's peak well below
  the shared pool size, not merely below it.
- Hot, locked, or transactional collection paths have deterministic
  maximum-cardinality tests for datastore call count, selected fields, external
  call count and concurrency, ordering, and required boundary revalidation.
  Tunable numeric caps live in the owning protocol or SLO docs and tests.

## Provider And Runtime Boundaries

- The admission owner rejects invalid shape or missing admission-time authority
  before committing accepted work. A valid durable accepted-work record is
  sufficient admission authority for model start; the runtime must not repeat
  route, provider, network, or mutable-authority checks before model work.
  Resolve mutable target and effect authority from durable owner facts only at
  the irreversible-effect boundary. Later authority loss takes a typed durable
  disposition rather than retroactively erasing accepted work or spawning
  repair machinery.
- When provider target identity and audience privacy are coupled, one live
  owner resolves the effective target and audience class atomically before
  model work. Persisted routes, snapshots, and legacy markers are hints, never
  authority; an unavailable owner causes a typed retry rather than successful
  consumption. Recheck the same effective target at irreversible provider
  entry, and do not require record-by-record repair when the live owner can
  resolve an authorized legacy hint.
- A scheduled automation occurrence uses the ordinary conversation turn
  planner, prompt stack, thread policy, skills, and dynamic-tool eligibility.
  Its stored instructions are the turn request; trusted occurrence and delivery
  facts are context, and the send-or-skip JSON object is only a delivery
  envelope. An active ordinary automation is independent authority: completion
  of a merely related plan or experiment cannot silently cancel it unless the
  stored instructions define that state as a skip condition or current evidence
  proves the occurrence's requested action already happened. Plan-owned support
  continues to use its typed owner and consent gates. Trigger origin must not
  select a second assistant profile or a reduced tool planner. Effects still
  require the same invocation ports, audience and accepted-input evidence, and
  owning-boundary validation as any other turn. The existing cron run record
  stores the scheduled occurrence and structured provider send-or-skip decision;
  surrounding job and session ids are the bounded record references, while
  private tool output and reasoning remain excluded.
- A detached system notification without a valid scheduled occurrence is not a
  user or automation turn. It runs as isolated output-only formatting with no
  conversation history, private context, resume mutation, tools, network, or
  delegated work. Provider, webhook, and other external values remain
  untrusted data, and the platform alone owns final delivery.
  Its restrictive configuration belongs to a fresh ephemeral thread on the
  resident App Server. It must not change provider process launch identity,
  replace the resident process, or persist a resumable notification thread.
- Provider shapes come from a pinned canonical SDK or published typed contract.
  A bespoke boundary needs a documented reason and exact-shape tests. On the
  foreground path, an external call may fail or delay a reply only when the
  current input needs its result. Each provider or network wait declares the
  applicable deadline, idle timeout, abort, fallback, and retry behavior in its
  owner contract.
- A decision derived from provider data covers every documented accepted
  payload variant with exact-shape regressions. Unknown or unsupported shapes
  take the flow's declared safe disposition.
- Execution planes stay thin. Platform coordination, secret injection,
  workspace transport, and write fences remain separate from assistant business
  logic, canonical data semantics, and product state.
- A runtime ownership grace window may be bypassed only after exact,
  target-specific proof that the prior owner has no live execution. Missing,
  ambiguous, or same-target evidence stays fail-closed, and concurrent claimants
  converge on the durable owner record.

## Product-Critical Flow Preservation

- Safety, reliability, privacy, authentication, and review fixes preserve the
  authorized success path for existing critical flows. Disabling, silently
  dropping, or degrading the flow is a product decision, not a technical fix.
- A direct Stripe subscription classified as a Family-sponsored loser may be
  canceled or refunded only while holding the Family owner lock before the
  sponsored-member lock and re-proving the exact active membership, paid local
  Family binding, provider-current active Family subscription identity, and
  direct-subscription ownership. If Family authority changes first or Stripe no
  longer confirms that exact Family authority, the receipt remains retryable
  and a pending Checkout attempt remains available for replay as the member's
  direct subscription.
- A live monthly group sponsorship is a payer authorization, not a Stripe
  subscription and not a message bundle. It stores only payer, beneficiary,
  status, $5/$10/$20 cap, and anchored period. Current-period committed spend is
  derived from exact-$5 `HostedUsageCreditPurchase` rows in fulfilled or pending
  states; `HostedUsageCreditEntry` is the only balance and unused credit carries
  forward. One live authorization per group is database-enforced. Refill
  admission occurs only inside the existing beneficiary serialization boundary,
  provider work is post-commit, Stripe reconciliation alone grants credit, and
  the sponsorship projection reveals only sponsored versus unsponsored. A
  separate room-public usage projection may reveal only the bounded percentage
  of current-period included usage already used. That aggregate is independent
  of purchased, referral, carryover, and refill credit; it never reveals or
  implies payer identity, sponsorship setup, money, credit remaining, period
  dates, message counts, or whether effective room capacity is exhausted.
- Purchased hosted usage credit belongs to its beneficiary, not its payer. A
  payer deletion must first resolve nonterminal payment state and must not
  delete fulfilled credit owned by a surviving beneficiary. Terminal
  cross-owner purchases may detach the payer only while invalidating in-flight
  payer-era reconciliation, clearing payer-bound ciphertext, and retaining the
  non-secret lookup evidence required to reconcile later refunds or disputes.
- Earned hosted referral credit also belongs to its frozen beneficiary and has
  no clawback path. If a referrer or introduced member deletes their account
  after a surviving group was rewarded, deletion anonymizes the rewarded
  accounting receipt instead of deleting the group's grant. Unrewarded
  referral state and all referral state whose beneficiary is deleted are
  removed.
- Hosted referral rolling caps reserve armed and bound commitments under the
  same beneficiary serialization boundary as grants. Armed rows reserve through
  their seven-day occurrence window; bound rows remain reserved through the
  product-owned 25-hour late-evidence grace, after which
  referrer-serialized expiry is authoritative finality. A qualification
  timestamp committed inside the provider-ingress transaction freezes a
  pre-expiry success; delayed reconciliation may revalidate its stored evidence
  but must not revoke it because wall-clock expiry or later commitments moved.
- The company-wide tracked fulfilled usage-top-up total seeds from retained
  fulfilled rows at an atomic tracker cutover and does not claim complete
  pre-cutover lifetime history. It then increments from the first successful
  purchase-status transition to fulfilled, inside that transaction. It is one
  anonymous count with no member, purchase, payment-provider, event, or timing
  reference; fulfillment replay and rollback cannot increment it, and later
  account deletion cannot decrement it.
- Identity, authentication, consent, privacy, recipient, and irreversible-effect
  authority fail closed. An advisory dependency may degrade only into an
  already-authorized narrower path and never silently suppress an accepted
  reply.
- Explicit hosted health-data withdrawal revokes processing authority before
  cleanup. AI and message admission, queued runtime usage, source connections,
  webhooks, scheduled sync, and companion processing independently reject that
  state. The withdrawal response waits for the per-user Cloudflare execution
  barrier to serialize behind earlier ensures, re-read the Web-owned grant,
  clear the write fence, and stop the runner; every later ensure re-reads that
  grant before work. Renewal waits behind the earlier stop before committing a
  new grant. Cleanup failure cannot restore authority, while an absent legacy
  grant is not reinterpreted as withdrawal. Settings, latest-available export,
  and account deletion remain available; renewed consent is the only processing
  restore path.
- The Cloudflare Worker that can retain an exact user-control stop target after
  clearing write authority is a hard rollback floor after the first such row is
  written. Withdrawal and account deletion must consume that same persisted
  target; an older Worker that derives its own versioned target is not a valid
  rollback candidate. The consent-aware Web artifact is also a hard rollback
  floor after it can record an explicit revoke because Web-only ingress and
  shared-data readers must enforce that row. Recovery uses a coordinated
  forward fix on the compatible Web and Worker pair.

## Deployment Compatibility

- Cross-plane changes state safe deploy order, warm-old-bundle behavior,
  rollback floor, and whether coordinated deployment is required.
- Schema and protocol evolution is additive-first. Compatibility stays
  legacy-facing, includes a removal condition, and is deleted after verified
  production drain.

## Observability And Bounded Growth

- Observability work never adds user latency. Diagnostics never block provider
  start or delivery. Once the active reply cannot continue, a bounded
  best-effort crash record may run.
- Capture structured errors at the root boundary, apply shared redaction, and
  preserve a stable code plus useful redacted cause. Never expose secrets,
  message content, private identifiers, or local paths in external artifacts.
- Growing persisted collections declare ownership, retention, indexing or
  pagination, snapshot treatment, and cardinality or byte limits. Hosted
  workspace files also follow `docs/contracts/06-hosted-workspace-file-count.md`.

## Executable Proof

- Make hot-path size, dependency closure, call ordering, scan complexity, state
  placement, provider shape, and replay boundaries executable with
  deterministic tests when prose cannot prevent drift.
- Tunable latency budgets, retry counts, scan limits, and output limits live in
  owner protocol or SLO docs and tests so they can be measured and ratcheted
  without turning this file into configuration. Fixed numeric floors explicitly
  elevated to baseline invariants are mirrored mechanically in owner config and
  tests.
- Codex test doubles sit behind the production adapter. They may fake unsafe
  external edges, credentials, time, and deliberate failures; they must not
  maintain a second Codex lifecycle, protocol, scheduler, supervisor, or retry
  system. Harness-only needs stay in test composition; production branches,
  flags, routes, exports, lifecycle state, or protocol machinery never exist
  solely for tests.
- A feature is complete only when its user-visible outcome is reachable through
  the wired production path.

Detailed owners: `ARCHITECTURE.md`, `agent-docs/PRODUCT_SENSE.md`,
`agent-docs/PRODUCT_CONSTITUTION.md`, `agent-docs/SECURITY.md`,
`agent-docs/RELIABILITY.md`, `agent-docs/references/hosted-runtime-protocol.md`,
`docs/contracts/03-command-surface.md`, and
`agent-docs/operations/imessage-deliverability.md`.
