# Baseline Invariants

This file contains Murph's cross-cutting engineering rules. Product behavior
belongs in product specs. Protocol details, file paths, provider fields,
numeric tuning, incident history, and rollout case law belong in owner docs and
executable tests.

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

## Foreground Reply Critical Path

- A durably accepted current conversation message is the runtime's
  highest-priority work.
- From durable acceptance through provider start and durable reply handoff,
  await only the current input, current authority and decryption, routing,
  minimal current-conversation context, assistant execution, and minimum
  delivery-intent state required for that reply.
- Projection, enrichment, diagnostics, telemetry, usage accounting, retention,
  compaction, cleanup, device sync, browser refresh, cron, replay catch-up, and
  unrelated mailbox work stay off that path. Keep their static dependency
  closure and initialization off-path too, not only their explicit waits.
- Signal foreground availability at the earliest durable staging boundary,
  before projection, full import completion, maintenance, or routine
  checkpointing. Typing or activity signals are best-effort and cannot delay
  provider start.
- Background work runs in finite abortable units, checks for fresh input before
  each unit, and derives continuation from durable owner state. Preemption
  defers work; it never drops it.
- A foreground prerequisite is a named current fact, not a generic lane or
  backlog. Bound unavoidable pre-provider and pre-delivery collections and
  waits, but never let background, replay, maintenance, or diagnostic budgets
  cap fresh accepted input.
- Routine hosted workspace snapshot publication is idle-only and interruptible.
  Current-turn durability barriers may run only for facts the current reply or
  effect consumes. Before provider start, that is limited to accepted-input and
  turn-ownership proof; before an irreversible send, to the minimal outbox
  identity and intent needed for replay safety. Unrelated work cannot join.
- Once a reply is ready, optional logging, telemetry, usage flushing, typing
  teardown, cleanup, or reconciliation cannot delay delivery. Attempt-bound
  acceptance, staging, local-turn, first-output, and delivery telemetry is
  content-free, best-effort, and nonblocking.

## Accepted Work And External Effects

- Every durably accepted conversational input reaches a restart-safe terminal
  disposition: delivered response, explicit policy non-reply, or an explicit
  durable supersession record naming the later accepted input. Accidental
  silence is not terminal.
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

## Authority, Ownership, And State

- Each fact that can change a durable decision has one owning source and one
  resolver. Caches, projections, snapshots, runtime state, aggregates, and
  provider callbacks are accelerators unless the owner contract says otherwise.
- Validate durable authority when an operation crosses a lifetime, target, or
  irreversible-effect boundary. Carry narrow typed proof within that bounded
  operation instead of making sibling layers rediscover it. Model-supplied
  targets are requests, never authority.
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

## Ordered Progress And Bounded Work

- Cursors, watermarks, sequences, pending-input indexes, and pagination use one
  total, transitive, owner-shared ordering primitive. Import progress is not
  handling progress.
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

## Provider And Runtime Boundaries

- Side effects, automations, notifications, and provider calls need a concrete
  authorized target before execution. Invalid routes and unauthorized actions
  fail before model or provider work; do not add a queue or repair worker to
  compensate for an invalid shape.
- Provider shapes come from a pinned canonical SDK or published typed contract.
  A bespoke boundary needs a documented reason and exact-shape tests. On the
  foreground path, an external call may fail or delay a reply only when the
  current input needs its result. Each provider or network wait declares the
  applicable deadline, idle timeout, abort, fallback, and retry behavior in its
  owner contract.
- Execution planes stay thin. Platform coordination, secret injection,
  workspace transport, and write fences remain separate from assistant business
  logic, canonical data semantics, and product state.

## Product-Critical Flow Preservation

- Safety, reliability, privacy, authentication, and review fixes preserve the
  authorized success path for existing critical flows. Disabling, silently
  dropping, or degrading the flow is a product decision, not a technical fix.
- Identity, authentication, consent, privacy, recipient, and irreversible-effect
  authority fail closed. An advisory dependency may degrade only into an
  already-authorized narrower path and never silently suppress an accepted
  reply.

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
- Numeric latency budgets, retry counts, scan limits, and output limits live in
  owner protocol or SLO docs and tests so they can be measured and ratcheted
  without turning this file into configuration.
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
