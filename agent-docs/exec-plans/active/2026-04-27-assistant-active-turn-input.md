# Assistant Active Turn Input

## Goal

Replace the assistant auto-reply "new message arrived before delivery; revise
and rerun" behavior with a greenfield active-turn input primitive modeled after
Codex's pending-input turn loop.

Success criteria:

- Same-conversation input that arrives while the assistant is working is accepted
  into the active logical assistant turn before outbound delivery.
- The provider sees accepted late input at the next safe model-request boundary,
  without rerunning already completed provider/tool work.
- OpenAI Responses-backed providers can continue the same logical turn through
  provider state (`previousResponseId`) when allowed, or explicit history when
  provider state is disabled.
- Hosted Cloudflare execution supports the same primitive by importing late
  conversation mailbox input inside the active foreground runtime and notifying
  active-turn admission, not only before delivery.
- The old `before_delivery` revision hook and revision exception are removed
  from the intended path after the hosted mailbox/checkpoint hard cut is stable.

## Constraints

- Greenfield semantics: no compatibility layer that preserves
  `before_delivery` as a first-class phase.
- Preserve web-owned mailbox/workspace state and Cloudflare's thin runner
  boundary; runtime owns import, checkpoint, and local active-turn semantics.
- Layer on top of the hosted mailbox/checkpoint migration. Do not block that
  migration, reintroduce web-owned turn-input adoption, or fork hosted assistant
  semantics while the hard cut lands.
- Accepted input must become canonical assistant turn history before the next
  provider request is built.
- Do not replay non-replayable tool or provider-side actions to handle late
  input.
- Keep hosted logs, traces, receipts, and debug events privacy bounded: no raw
  message text, provider payloads, credentials, contact identifiers, decrypted
  vault content, or local filesystem paths.
- Preserve unrelated active work in the shared checkout.

## Migration Alignment

`migration.md` is landing the hosted runtime hard cut first. That plan deletes
web-owned runs, executor-facing turn-input peek/adopt, Cloudflare run-drain
state, and hosted side-effect finalization. The day-one migration intentionally
keeps the existing local `before_delivery` revision loop by injecting a
mailbox-backed hosted turn-input port.

This active-turn plan should be implemented as the next runtime layer after that
hard cut, not as a blocker for it:

- The migration establishes the correct ownership boundary: web appends encrypted
  mailbox items and stores the latest encrypted workspace checkpoint; Cloudflare
  coordinates a leased runner; assistant runtime imports mailbox items, owns turn
  semantics, and checkpoints local state.
- Active-turn input replaces the local revision loop once the mailbox/checkpoint
  runner is stable. It should consume the same runtime-owned mailbox importer and
  checkpoint port rather than adding a new hosted queue or web adoption protocol.
- `hosted-mailbox.json` remains import state only: per-lane watermarks,
  quarantine metadata, and refresh metadata. It must not mirror active-turn
  history or become a per-message completion ledger.
- The accepted-input journal belongs in assistant runtime state inside the
  encrypted workspace checkpoint. It is the source for provider-visible
  active-turn history, not a companion to a second mutable turn-history store.
  It records ordered input ids, capture ids, transcript/content references,
  source-specific cursor effects, provider request ordinals, and reconstruction
  metadata. Raw contact, conversation, thread, and reply-target identifiers stay
  in their owner records; the accepted-input journal should use opaque refs and
  coarse fallback metadata only.
- The active-turn hosted path should target the new workspace runner shape:
  `runHostedWorkspaceUntilIdleOrBudget` or its workspace-invocation entrypoint,
  `HostedRuntimePlatform.mailboxPort`, `HostedRuntimePlatform.workspacePort`, and
  the runtime mailbox import state. Do not target deleted run-control, peek/adopt,
  or Cloudflare-local turn-input surfaces.
- Outbox intent checkpointing is the user-visible commit boundary. Once the
  runtime has checkpointed an outbox intent for a reply, later passive mailbox
  input belongs to a later turn.

## Landed Slice

2026-04-28 implementation slice:

- Added the assistant-engine accepted active-turn input journal scaffold under
  assistant runtime state, exposed through `turns.acceptedInputs`.
- The journal is metadata-first: ordered accepted input ids, capture ids,
  transcript/content refs, coarse prompt-fallback metadata, cursor effects,
  admission state, and provider request ordinals. It does not persist raw prompt
  fallback text, raw conversation/contact/reply-target identifiers, or duplicate
  hosted mailbox message state.
- Added append/read/admission-state/provider-request helpers with identity
  checks for session drift, accepted-input id ordering, and
  append-only provider request ordinals.
- Added the provider continuity policy primitive:
  `continuous-provider-thread` for manual chat, `murph-history-only` for
  auto-reply, cron automation, and notification-decision turns.
- Native provider resume request, provider-failure resume recovery, and
  finalizer-time provider resume persistence are all gated by the resolved
  continuity policy. This folds the stale auto-reply resume fix into the durable
  policy rather than a trigger-local execution hack.
- Hosted/Cloudflare active-turn admission is intentionally not wired in this
  slice. That should land after the mailbox/checkpoint hard cut has stabilized,
  using the runtime-owned mailbox/workspace ports from `migration.md`.

2026-04-28 follow-up implementation slice:

- Tightened the accepted-input journal invariants from the review pass:
  provider requests now represent the full current accepted-input snapshot, and
  appends cannot close current-turn admission in the same write that adds new
  input.
- Marked `.runtime/operations/assistant/accepted-turn-inputs/**` as portable
  assistant runtime state and added hosted-bundle coverage proving it snapshots
  and restores with the encrypted workspace state.
- Made provider continuity policy required at the turn finalizer seam so future
  outbound automation cannot accidentally persist native provider resume by
  omission.
- Added the service-level active-turn admission hook:
  `activeTurnInput(request_boundary)` returns either `no-new-input` or a revised
  prompt/content/delivery metadata snapshot. `sendAssistantMessageLocal` now
  loops within one receipt and session lock, passing accepted input into the
  next provider request and delivering only the final provider response.
- Moved auto-reply off the intended `before_delivery` revision path. It now
  materializes late same-conversation captures through the active-turn hook,
  updates the final auto-reply context from the accepted capture set, and
  commits artifacts/cursors/reply targets from that final context.
- Kept the old revision exception as a fallback only for cases that cannot yet
  be folded into active admission, such as late input that changes prompt
  preparation into defer/skip while the hosted hard cut is still landing.
- Added a budget-exceeded active-turn error so automation defers instead of
  failing if input keeps arriving across continuation boundaries.

2026-04-28 active-turn journal/runtime slice:

- Persist initial and accepted active-turn items from the service loop into the
  accepted-input journal before each provider request. Initial manual turns use
  coarse prompt fallback buckets; auto-reply turns provide inbox capture refs and
  cursor effects.
- Record accepted-input journal provider request ordinals before every provider
  request, using explicit structured history as the default continuation mode.
- Move usage persistence to each successful provider request and add
  `providerRequestOrdinal` to canonical usage ids/records so same logical turns
  can bill/audit multiple successful provider calls without id collisions.
- Superseded the interim hosted active-turn refresh/checkpoint port with the
  foreground hosted runtime wake path: Cloudflare only sends a payloadless wake,
  the active workspace runner imports the conversation mailbox lane with log
  reason `active_turn_input`, and assistant-engine admits staged input through
  the normal store-backed source.
- Keep Cloudflare/web as thin mailbox/workspace/control-plane adapters. No
  Cloudflare-local active-turn queue, peek/adopt protocol, or provider-specific
  steering semantics were added.

2026-04-28 provider-neutral history slice:

- Added an in-memory, provider-neutral active-turn history overlay for the
  current logical turn. When late input is accepted, the next provider request
  receives the prior accepted user content plus the prior provider draft as
  neutral `user`/`assistant` messages before the new current user prompt.
- Kept the accepted-input journal metadata-first. It remains the durable
  admission/order/audit record and does not persist raw prompt text or interim
  provider drafts.
- Wired the overlay through provider planning and provider helpers rather than
  provider adapters. Message providers receive neutral active-turn messages;
  flat-prompt providers receive an `Active turn so far` section.
- Disabled native resume for active-turn continuation requests until a provider
  can prove strict same-turn extension semantics. Explicit structured history is
  the cross-provider correctness path.
- Fixed auto-reply accepted-input cursor effects to use the pre-acceptance cursor
  as `from`, instead of the already-advanced accepted group cursor.

2026-04-28 hosted checkpoint barrier slice:

- Added a provider-neutral `checkpointAcceptedInput` active-turn port hook and
  `activeTurnCheckpoint` service hook.
- The local assistant turn loop now awaits that hook after accepted input is
  journaled and before building the continuation provider input, so hosted can
  durably checkpoint accepted input before provider-visible continuation
  sampling.
- Hosted runtime implements the hook as a workspace checkpoint with
  `active_turn_acceptance`, separate from mailbox refresh checkpoints
  (`active_turn_input`). The checkpoint status carries only counts and request
  ordinal metadata, not raw prompt content.

2026-04-28 durable transcript slice:

- Matched Codex's canonical-history behavior: each accepted active-turn user
  input is recorded as an ordered `user` transcript entry before the next
  provider request is built.
- Kept the accepted-input journal as the metadata/order/idempotency record, not
  a second durable conversation history. The journal continues to store refs,
  cursor effects, input ids, and coarse fallback buckets; durable transcript
  rows carry the replayable user text.
- When an auto-reply turn deferred the initial user transcript until finalizer
  time, the active-turn loop now persists that initial user prompt before the
  accepted late input, then disables finalizer-time prompt persistence to avoid
  writing the combined continuation prompt as a duplicate user row.
- Auto-reply accepted-input transcript text is scoped to the newly accepted
  capture summaries. Text captures use their message text; attachment-only or
  textless captures use neutral input placeholders instead of falling back to
  the full merged provider prompt.
- Manual `manual-ask`/`manual-deliver` triggers now classify accepted-input
  fallback metadata as manual input, matching the implicit manual default.
- Hosted checkpointing now sits after the accepted-input journal append and the
  transcript append, and still before continuation sampling, so hosted snapshots
  contain the same canonical state the provider is about to consume.

2026-04-28 hard-cut completion slice:

- Removed the legacy `before_delivery` refresh phase,
  `createAssistantTurnBeforeDeliveryHook`, and revision-required exception from
  the assistant-engine contract/export/test surface.
- Replaced final pre-outbox polling with an explicit active-turn
  `commit_barrier` admission phase. Hosted runtime refreshes the mailbox during
  both provider request-boundary and commit-barrier admission.
- Added a zero-accepted-input commit-barrier checkpoint so hosted can durably
  persist the final mailbox refresh/import state before outbox commit even when
  no additional input is accepted.
- Changed auto-reply late input to materialize only the newly accepted captures
  as the continuation prompt/content, while final delivery metadata and cursor
  effects derive from the final accepted capture set.
- Delivery now prefers the current active-turn input reply target over the
  initial shared-plan audience reply target, so a late Telegram message can
  become the final reply target without a bespoke Cloudflare branch.
- Receipt duplicate/recovery logic now considers both `turn.started` and
  `turn.input.accepted` metadata, so late accepted capture ids participate in
  duplicate detection and recovery grouping.
- Active-turn transcript persistence now stores each accepted input item as a
  separate user transcript row when item-level fallback text is available,
  keeping the transcript as canonical replayable history and the journal as the
  metadata/idempotency ledger.
- Provider continuation hard-cut behavior is in place: active continuations skip
  transcript replay while active-turn overlay history is present, native resume
  stays disabled for active-turn continuations, and failover freezes to the
  current route after non-replayable tool/provider work.

Remaining planned work after this slice:

- Add provider-turn id fencing when a provider exposes a stable active-turn id.
  Murph receipt `turnId` continues to fence product/runtime admission; provider
  ids should not be collapsed into session or receipt ids.
- Decide whether crash recovery for an interrupted active-turn continuation
  should persist privacy-bounded interim assistant draft refs. Current hard-cut
  behavior keeps interim drafts in in-memory active-turn overlay only; durable
  restart reconstructs from accepted user transcript plus journal metadata.

## Codex Reference Model

Codex's core shape is intentionally small:

- The active turn owns a `pending_input` queue.
- `turn/steer` validates an active steerable turn, checks the expected turn id,
  and appends user input to that queue.
- At safe request boundaries, the turn loop drains pending input, runs input
  hooks, records accepted input into canonical conversation history, and builds
  the next model request from that history.
- The turn continues while either the model needs follow-up work or pending input
  exists.
- Responses continuation is a transport optimization over the same history model,
  not the semantic owner of steering. Murph-owned explicit history remains the
  correctness mechanism.

Behaviors to copy:

- active turn id fencing for stale/racing steer requests
- pending input inspection/normalization through the same policy path as ordinary
  user input
- accepted pending input recorded into canonical history before sampling
- a delivery/admission phase gate that stops passive mailbox input from extending
  a turn after the user-visible answer has effectively committed. Murph adapts
  this to the outbox intent checkpoint boundary.

Behaviors not to copy:

- an extra idle pending-input queue when hosted mailbox/workspace checkpoints can
  remain the durable ordering source
- ambiguous APIs where "start" may opportunistically steer but returns a
  different id shape than explicit steer
- provider sampling preemption for ordinary user messages; late user input should
  wait for the next safe request boundary

## Proposed Primitive

Introduce a boundary admission primitive and canonical turn input item:

```ts
interface AssistantTurnInputItem {
  id: string;
  source: "initial" | "inbox" | "manual" | "system";
  captureIds: readonly string[];
  cursorEffects: readonly AssistantTurnInputCursorEffect[];
  conversationRef: AssistantOpaqueConversationRef | null;
  transcriptRef: AssistantTranscriptInputRef | null;
  contentRef: AssistantTurnInputContentRef | null;
  promptText?: string;
  userMessageContent?: AssistantUserMessageContentPart[] | null;
  deliveryReplyToMessageId?: string | null;
}

interface AssistantActiveTurnInputAdmission {
  admit(
    reason: "start" | "request_boundary" | "commit_barrier",
    fence: AssistantActiveTurnFence,
  ): Promise<AssistantTurnInputAdmissionOutcome>;
}

interface AssistantActiveTurnFence {
  turnId: string;
  sessionId: string;
  conversationFence: AssistantOpaqueConversationRef | null;
  providerAttemptId: string | null;
}
```

Accepted `AssistantTurnInputItem`s are persisted into the active turn's
accepted-input journal. After acceptance they are not treated as special "late"
input; the provider history builder reconstructs the next request from the
checkpointed journal plus prior assistant/tool outputs.

The active turn must also persist an accepted-input journal, because the current
transcript model only stores text rows and the current resume state only stores a
single provider session id. The journal should be portable assistant runtime
state and metadata-first: ordered input ids, capture ids, transcript/content
references, materializer version, admission state, source-specific cursor
effects, coarse fallback metadata, and provider request/continuation metadata
needed for explicit-history reconstruction. Do not store prompt text, raw
content parts, raw contact/conversation identifiers, or raw reply-target
identifiers in the accepted-input journal. If reconstruction is impossible from
existing private owner refs, defer/abort admission or create a private owner ref
first rather than writing raw content into this journal. Receipts, timeline
events, operator logs, and hosted status projections carry redacted ids, counts,
and cursors, not raw prompt or message content.

## Active Turn Loop

Target shape:

```txt
acceptedInputJournal starts with the initial input

loop:
  admission.admit("request_boundary")
  materialize and inspect boundary input
  persist accepted input items to the journal and checkpoint if hosted

  providerHistory = buildProviderHistory(acceptedInputJournal, provider outputs)
  providerResult = provider.sample(providerHistory, providerCursor)
  persist provider output in turn state

  if providerResult.needsFollowUp:
    continue

  admission.admit("commit_barrier")
  if new input was accepted:
    continue

  checkpoint outbox intent, persist transcript/session/receipt, and finish
```

`commit_barrier` is not a before-delivery rejection hook. It is the final
mailbox/import refresh before outbox intent creation and checkpointing. If input
appears, the turn continues. If it does not, the runtime checkpoints the outbox
intent and later passive input belongs to a later turn.

For hosted execution, every accepted mailbox-derived input must be an
accept-or-abort boundary:

1. refresh and import mailbox input through the runtime mailbox importer
2. materialize and validate the input
3. persist the accepted-input journal plus provisional reply-target and
   reconstruction metadata into the local workspace snapshot, without advancing
   automation cursors or marking captures handled
4. checkpoint through the hosted workspace CAS path
5. only after a successful checkpoint build provider-visible history from the
   checkpointed journal and continue sampling

If the checkpoint fails or conflicts, the active turn must not answer using that
input. It should abort/defer and let a later invocation rebuild from durable
workspace truth.

Hosted refresh maps to mailbox import, not a separate active-turn queue:

```txt
active turn requests admission
runtime fetches strict mailbox prefixes through mailboxPort
runtime imports mailbox items into local inbox/capture/runtime state
runtime advances hosted-mailbox import state only after durable import
runtime checkpoints through workspacePort
active turn materializes newly imported same-conversation captures
```

The active turn needs an admission state equivalent to Codex's mailbox delivery
phase:

```ts
type AssistantTurnInputAdmission =
  | "current-turn-open"
  | "passive-input-next-turn"
  | "commit-started";
```

Passive mailbox input may extend the current turn until outbox intent
checkpointing starts. Once `commit-started`, all new passive input belongs to a
later turn. Provider final-answer-like output is not by itself the commit; the
hosted/user-visible commit boundary is the outbox intent checkpoint.

## Provider Continuation

```ts
type AssistantProviderContinuation =
  | { kind: "explicit-structured-history" }
  | { kind: "provider-state-optimization"; responseId: string };
```

Provider differences collapse to two concepts:

- Explicit structured history is the correctness path. The provider request is
  rebuilt from the checkpointed accepted-input journal plus provider outputs.
- Provider state is an optimization when available. OpenAI Responses-compatible
  providers may continue using the prior provider response id when provider state
  is enabled and the new request is a valid continuation. If zero data retention
  disables provider state, if fallback is required, or if the request is not a
  safe incremental extension, rebuild explicit structured history from the
  journal.

Codex `turn/steer` is not a third semantic provider mode. It is an
adapter-specific transport that can accept explicit same-turn input while a
Codex turn is active, fenced by expected turn id and typed no-active-turn,
mismatched-turn, and non-steerable failures. Hosted mailbox input must never
steer a provider directly before mailbox import and workspace checkpoint
succeed.

The engine should avoid a provider-level abstraction that exposes inbox captures
or auto-reply grouping. Providers should receive history plus continuation
cursor/state only.

Failover freezes after non-replayable work. Once a provider attempt has executed
tools, provider-side actions, or returned provider action errors, active-turn
continuation must stay on that provider route or defer/fail; it must not replay
partial turn history through a different provider as if it were a fresh attempt.

Usage accounting needs a continuation/request ordinal so multiple provider
requests inside one visible assistant turn cannot collide on the existing
`turnId + attemptCount` usage identity.

## Provider State Policy

Provider-native resume is an optimization for explicitly continuous turns, not a
source of truth for outbound automation. Manual direct chat can keep native
provider resume when the saved route binding still matches. Automation turns
that compose an outbound message from Murph-owned transcript, captures, and
runtime state should not inherit an arbitrary provider thread.

Auto-reply in particular must rebuild from Murph-owned state:

- It must not pass a saved Codex thread id, OpenAI response id, or other provider
  resume handle into the provider request.
- It must not persist a provider-native resume handle from the auto-reply turn
  back onto the shared assistant session.
- It may still persist Murph-owned transcript, receipts, accepted-input journal
  entries, and outbox state.
- Any future same-turn continuation must come from the active-turn accepted-input
  journal and provider history builder, with provider state used only as a
  validated optimization for that same logical active turn.

This replaces the tactical trigger-specific fix of simply disabling native
resume for `automation-auto-reply`. The durable shape is a turn-continuity policy
that decides both execution-time resume use and finalizer-time resume
persistence:

```ts
type AssistantTurnContinuityPolicy =
  | "continuous-provider-thread"
  | "murph-history-only";
```

`continuous-provider-thread` is appropriate for manual chat and explicit
same-turn provider continuations. `murph-history-only` is appropriate for
auto-reply, notification decision, and other outbound automation turns unless a
future feature explicitly defines a safe continuity contract.

## Materialization

Auto-reply captures need a small materialization layer before entering the
accepted-input journal:

```ts
interface AssistantTurnInputMaterializer {
  materialize(captures: readonly InboxCaptureSummary[]): Promise<
    | { kind: "ready"; item: AssistantTurnInputItem }
    | { kind: "defer"; reason: string }
    | { kind: "skip"; reason: string }
  >;
}
```

This owns capture grouping, prompt rendering, multimodal attachment preparation,
reply-target selection, source-specific provisional cursor effects, and
pending-attachment defer decisions. Once materialized, the active-turn loop does
not care whether the input came from Telegram, Linq, email, hosted mailbox, or
manual chat.

Auto-reply cursor advancement, receipt capture metadata, duplicate detection,
and delivery reply target must derive from the final accepted input set, not the
original scan group. The active turn should expose a final accepted-input
snapshot:

```ts
interface AssistantAcceptedTurnInputSnapshot {
  inputIds: readonly string[];
  captureIds: readonly string[];
  cursorEffects: readonly AssistantTurnInputCursorEffect[];
  deliveryReplyToMessageId: string | null;
}
```

## Planned Code Shape

- `packages/assistant-engine/src/assistant/turn-input.ts`: replace
  `AssistantTurnBeforeDeliveryHook`, `AssistantTurnRevisionRequiredError`, and
  the `before_delivery` phase with active-turn input items, materialization, and
  admission contracts.
- `packages/assistant-engine/src/assistant/turns.ts` and
  `runtime-state-service.ts`: add the durable active-turn accepted-input journal
  and provider history builder surface.
- `packages/assistant-engine/src/assistant/local-service.ts`: move from a
  single provider call followed by delivery to an active-turn loop that persists
  all accepted user inputs and one final assistant output. Route automation
  auto-reply through a Murph-history-only continuity policy instead of a
  trigger-local native-resume hack.
- `packages/assistant-engine/src/assistant/turn-finalizer.ts`: persist every
  accepted user input in order rather than only the initial prompt, and clear or
  avoid provider-native resume state when the turn continuity policy is
  Murph-history-only.
- `packages/assistant-engine/src/assistant/service-usage.ts`: include provider
  request/continuation ordinals in hosted usage records.
- `packages/assistant-engine/src/assistant/provider-turn-runner.ts`: pass active
  provider history and provider continuation cursor through provider execution
  without replaying non-replayable work, and derive native resume use from the
  turn continuity policy.
- `packages/assistant-engine/src/assistant/providers/openai-compatible.ts`: add
  Responses continuation around history, treating `previousResponseId` as an
  optimization when allowed and explicit history as the fallback correctness
  path.
- `packages/assistant-engine/src/assistant-codex.ts`: add app-server
  `turn/steer` support while the Codex turn is active, with race fallback for
  missing or mismatched active turns.
- `packages/assistant-engine/src/assistant/automation/reply.ts`: delete the
  auto-reply revision loop; initial groups and late same-conversation captures
  both materialize into active-turn input items.
- `packages/assistant-runtime/src/hosted-runtime/**`: after the hosted hard cut,
  replace mailbox-backed `before_delivery` revision with active-turn admission in
  `runHostedWorkspaceRuntimeJobInProcess` and the inner
  `runHostedWorkspaceUntilIdleOrBudget` loop. Keep hosted admission expressed
  through semantic `mailboxPort` and `workspacePort` calls, and make accepted
  input checkpointing an accept-or-abort boundary before provider-visible use.
- `apps/cloudflare/src/runtime-platform.ts`: expose the generalized hosted
  runtime mailbox/workspace refresh support without owning mailbox state, active
  turn state, or provider history.
- `packages/operator-config/src/assistant-cli-contracts.ts`: add a receipt
  timeline event such as `turn.input.accepted` with redacted ids, counts,
  cursor-effect metadata, and reply-target references. Do not include raw prompt
  or message content in operator-visible events.

## Invariants To Preserve

- A capture is handled only after it is accepted into a turn and that turn later
  completes or defers with durable receipt evidence.
- Hosted accepted input is provider-visible only after its input journal and
  mailbox import state have been checkpointed successfully.
- Hosted import state stays in `hosted-mailbox.json`; accepted active-turn
  history stays in assistant runtime state inside the encrypted workspace
  checkpoint.
- Acceptance into an active turn is not the same as handled/completed. Automation
  cursor advancement and handled-capture marking happen only at final
  completion/defer receipt.
- Auto-reply cursor advancement uses the active turn's final accepted cursor,
  not the original scan-group cursor.
- Transcript persistence records every accepted user input in order.
- Delivery reply target can advance to the latest accepted message where the
  channel supports reply-to behavior.
- Usage accounting records every provider request in a multi-request active
  turn.
- Failover does not replay provider work after tool calls or provider-side
  actions.
- Zero-data-retention routes do not rely on provider state.
- `previousResponseId` is never the only source of correctness; Murph history is.
- Outbound automation uses Murph-history-only continuity by default: no
  provider-native resume on request, and no provider-native resume persistence
  after finalization.
- Hosted mailbox refresh imports and checkpoints before provider-visible
  consumption.
- Outbox intent checkpointing closes passive input admission for that reply.

## Stress-Test Notes

Four GPT-5.5 high review passes were run before finalizing this plan: two
against `../codex` and two against Murph/migration integration hazards. The
final shape incorporates these findings:

- Codex confirms this should be a turn-loop primitive, not a delivery hook.
- Codex's active-turn id fence should be copied so stale/racing steer requests
  cannot attach input to the wrong turn.
- Codex's mailbox delivery phase should be copied conceptually as a Murph
  admission gate.
- OpenAI `previous_response_id` should be treated as an optimization over
  history, not as the semantic source of active-turn correctness.
- Late input must run the same validation/materialization path as normal input.
- Do not copy Codex's extra idle pending-input queue or its ambiguous start vs
  steer API split.
- Hosted checkpoint atomicity is the highest-risk Murph integration issue:
  accepted mailbox input must checkpoint before provider-visible consumption.
- Murph's current transcript/resume persistence cannot represent active-turn
  input items without a new accepted-input journal or equivalent receipt/state
  surface.
- Auto-reply cursor advancement, duplicate detection, and reply target must be
  computed from the final accepted input snapshot.
- Failover must freeze after non-replayable provider/tool work.
- Usage records need request/continuation ordinals for multi-request turns.
- The hosted hard-cut migration should land first with the current
  mailbox-backed `before_delivery` revision loop; this plan then replaces that
  loop on top of the same mailbox/checkpoint ownership boundary.
- The final hosted target is the workspace invocation runner plus semantic
  mailbox/workspace ports, not deleted run-control or turn-input peek/adopt
  surfaces.
- The final primitive is smaller as: active-turn admission state, checkpointed
  accepted-input journal, provider history builder, and provider-state
  optimization. Hosted mailbox remains an import source only.
- Hosted admission should be a boundary operation, not a generic durable
  `refresh/drain/hasPending` queue.
- Accepted-input journaling is metadata-first and must not become duplicate
  cursor/completion/message-history state.
- Stale provider-native resume in auto-reply is a symptom of missing continuity
  policy. The long-term fix is Murph-history-only continuity for outbound
  automation, including finalizer-time resume clearing, not a one-off
  `automation-auto-reply` execution profile special case.

## Verification Targets

For the implementation wave, expect at minimum:

- `pnpm typecheck`
- `pnpm test:diff` over touched assistant-engine, assistant-runtime, and
  Cloudflare files when it truthfully covers the slice, otherwise package/app
  coverage or verify commands from `agent-docs/operations/verification-and-runtime.md`
- focused tests for auto-reply late input, Codex `turn/steer`, Responses
  continuation, hosted mailbox checkpoint refresh, duplicate receipt detection,
  zero-data-retention explicit-history continuation, and non-replayable tool
  continuation/defer behavior
- provider-state policy tests proving auto-reply and notification-style outbound
  automation do not pass stale provider resume handles, do not persist new
  provider resume state, and still reconstruct context from Murph transcript and
  accepted-input journal; manual chat should continue to preserve native resume
  where route binding matches
- hosted migration compatibility tests proving the mailbox/checkpoint runner can
  still land first with the current revision loop, and active-turn follow-up
  tests proving no live code reintroduces web-owned turn-input adoption
- `git diff --check`
