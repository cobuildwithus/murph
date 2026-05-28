# Active Turn Live Input Unification

## Goal

Make new same-conversation input from manual sends, Telegram, Linq, and hosted
mailbox sources enter the current running assistant turn immediately when a live
provider turn can be steered, without adding bespoke hosted-vs-local or
manual-vs-auto-reply steering paths.

Success criteria:

- Same-conversation input imported while a Codex app-server provider turn is
  running can reach `turn/steer` before the provider request completes.
- Manual sends and inbox/mailbox captures converge through one controller queue
  and one accepted-admission shape.
- Local and hosted differ only at `AssistantTurnInputPort` construction and
  refresh/checkpoint behavior, not in controller or provider steering code.
- The hard cut removes the target manual-vs-auto-reply live-input split rather
  than leaving a compatibility path as the long-term implementation.
- Accepted input still commits through the existing local-service
  journal/transcript/checkpoint/outbox path.
- Boundary admission remains as the fallback for missed events, failed live
  steering, stale turns, non-steerable providers, and provider-close races.

## Implementation Status

Implemented in `packages/assistant-engine`:

- `AssistantActiveTurnInputAdmissionInput` now uses the shared
  `input_available` / `request_boundary` / `commit_barrier` phase vocabulary
  and no longer carries provider response text or request ordinals.
- Accepted active-turn admissions now require durable `acceptedInputs`; the
  local-service `request-${ordinal}` fallback was removed.
- `ActiveTurnInputController` queues accepted admission snapshots for both
  manual sends and materialized inbox/mailbox input, owns provider steer
  acknowledgement state, and exposes `notifyAssistantActiveTurnInputAvailable`.
- Local automation import events notify the active controller by conversation
  while preserving the scanner wake as fallback.
- Auto-reply active-turn hooks now split materialization from checkpoint-time
  context/progress commits and guard pending accepted captures from duplicate
  materialization before checkpoint.
- The controller runs a bounded generic live refresh pump while a steerable
  provider turn is registered, so hosted `AssistantTurnInputPort.refresh`
  implementations can surface mailbox input without hosted-specific controller
  logic.

Verification:

- `pnpm --filter @murphai/assistant-engine typecheck`
- `pnpm --filter @murphai/assistant-engine test -- assistant-local-service-runtime.test.ts assistant-automation-runtime.test.ts assistant-turn-input.test.ts`
- `pnpm typecheck`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-turn-input.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-maintenance.test.ts`

Known unrelated verification note:

- `pnpm --filter @murphai/assistant-runtime test -- hosted-runtime-turn-input.test.ts hosted-runtime-workspace-runner.test.ts hosted-runtime-maintenance.test.ts`
  currently runs the whole package test set and hit the separate active
  hosted-inbox-artifact-restore failure in
  `hosted-runtime-workspace-entrypoint.test.ts`.

## User-Observed Failure

A Telegram capture was imported during an active Codex app-server provider turn,
but it was only accepted near the end of the provider request.

Observed shape:

```txt
capture imported
provider continues thinking/tool work
new input accepted into active turn
assistant replies
```

The import path is fast enough. The delay comes from active-turn admission for
inbox/mailbox input still being boundary-driven. Manual same-conversation sends
can already live-steer because they enter `ActiveTurnInputController.enqueue()`
and can call the registered provider `steer()` handle immediately. Telegram,
Linq, and hosted mailbox captures enter through the auto-reply admission hook,
which is currently invoked only after provider output or at the commit barrier.

## Constraints

- Do not create a parallel durable input model. Reuse
  `AssistantActiveTurnInputAdmissionResult`,
  `AssistantAcceptedTurnInputItemInput`, and the accepted-input journal.
- Do not add a hosted-only active queue, local-only capture shortcut, or
  manual-send-only steering path.
- Do not branch controller/provider steering logic on `hosted`, `local`,
  `telegram`, `linq`, or `auto-reply`.
- Keep Telegram/Linq/email/provider-source details below the active-turn layer in
  inbox/mailbox capture materialization.
- Keep hosted mailbox import and workspace checkpoint ownership inside the
  existing hosted `AssistantTurnInputPort` wrapper.
- Keep `local-service` as the only durable commit owner for accepted input,
  transcripts, active-turn checkpoints, provider request prefixes, outbox
  intents, and final delivery.
- A live steer alone must never mark captures handled, advance auto-reply
  cursors, create outbox intents, or dispatch delivery.

## Existing Primitives To Reuse

- `AssistantTurnInputPort`: source refresh/list/checkpoint abstraction.
- `AssistantActiveTurnInputAdmissionResult`: provider-facing accepted input
  snapshot.
- `AssistantAcceptedTurnInputItemInput`: durable accepted-input item shape.
- Accepted-input journal: durable input order, capture ids, content refs, cursor
  effects, admission state, and provider request prefixes.
- `ActiveTurnInputController`: live provider registration, pending queue,
  completion promise, coalescing, and `providerAlreadySteered` transport state.
- `local-service`: provider loop plus durable
  journal/transcript/checkpoint/outbox ownership.
- Hosted runtime turn-input wrapper: hosted mailbox import and workspace
  checkpoint behavior behind the same `AssistantTurnInputPort` surface.

## Target Architecture

The target pipeline is:

```txt
input available signal
  -> ActiveTurnInputController
  -> existing admission hook runs shared materializer
  -> materializer uses AssistantTurnInputPort refresh/list/checkpoint seams
  -> materializer returns AssistantActiveTurnInputAdmissionResult
  -> controller live-steers if a steerable provider turn is registered
  -> local-service commits through the existing journal/transcript/checkpoint/outbox path
```

Source-specific behavior is allowed only at the edge:

- Local inbox: refresh is a no-op and listing reads already-imported captures.
- Hosted mailbox: refresh imports and checkpoints mailbox state before listing
  captures.
- Manual send: materializes into the same accepted-admission shape without inbox
  cursor effects.
- Telegram/Linq/email: normalize through inbox/mailbox capture materialization,
  not provider steering code.

The controller should see accepted input, source metadata, and optional live
provider steering capability. It should not know whether input came from hosted
mailbox, local inbox, Telegram, Linq, or manual UI.

`AssistantTurnInputPort` should stay outside the controller. The controller
already has a source-agnostic integration point: `admissionHook`. Live admission
should call that hook with an `input_available` phase, then queue the accepted result. The
port remains owned by the auto-reply/hosted materializer that already knows how
to refresh, list, and materialize inbox captures.

## Required Shape Changes

1. Extract auto-reply capture materialization.

   Move the reusable body of
   `createAssistantAutoReplyActiveTurnInputHook()` into a helper that returns an
   accepted active-turn admission, the next auto-reply group context, and any
   redacted progress event that should be emitted after acceptance is committed.

   It should keep the existing logic for:

   - `AssistantTurnInputPort.refresh()`
   - same-conversation capture listing
   - group context merge
   - prompt and `userMessageContent` preparation
   - `buildAutoReplyAcceptedTurnInputItems()`
   - receipt metadata
   - transcript text
   - delivery reply target selection

   Replace the current separate hook creators with one factory:

   ```ts
   createAssistantAutoReplyActiveTurnInputHooks() => {
     admit,
     checkpoint,
   }
   ```

   `admit` materializes candidate input. `checkpoint` first delegates to
   `port.checkpointAcceptedInput` when present, then applies the pending
   accepted context and emits the redacted progress event after durable
   acceptance succeeds. This keeps context mutation out of materialization
   without adding a generic controller callback surface.

   The helper must split materialization from commit. It should not mutate the
   auto-reply context, call `onAcceptedContext`, emit the accepted-progress
   event, mark captures handled, or advance cursors while merely materializing a
   live input candidate. Those effects should happen only after local-service has
   appended the accepted input, appended transcript refs, and completed the
   active-turn checkpoint.

2. Collapse active-turn phases.

   `AssistantActiveTurnInputAdmissionInput` is currently wider than the
   materializers need: it carries provider response text and request ordinals
   even though the auto-reply hook only uses phase. The hard-cut target should
   remove fake boundary data from admission and use one phase vocabulary for
   admission and source refresh.

   Target shape:

   ```ts
   type AssistantActiveTurnInputPhase =
     | 'input_available'
     | 'request_boundary'
     | 'commit_barrier'

   interface AssistantActiveTurnInputAdmissionInput {
     knownCaptureIds?: readonly string[]
     knownInputIds?: readonly string[]
     phase: AssistantActiveTurnInputPhase
     sessionId: string
     signal?: AbortSignal
     turnId: string
     vault: string
   }
   ```

   Align `AssistantTurnInputRefreshPhase` to the same phase type. Replace
   `after_provider` with `request_boundary`, keep `commit_barrier`, and add
   `input_available`. Keep `providerRequestOrdinal` on checkpoint input, where
   it is actually used.

3. Queue accepted admission snapshots in the controller.

   Replace the controller's target manual-vs-hook split with one private queue
   shape. Manual input becomes a small adapter that validates
   `expectedActiveTurnId`, builds an accepted admission with stable manual input
   ids, and enqueues that admission. Inbox/mailbox input builds the same accepted
   admission through the extracted admission hook and enqueues it.

   Target private shape:

   ```ts
   interface QueuedTurnInputAdmission {
     admission: AssistantAcceptedActiveTurnInputAdmission
     completion?: ManualCompletion
     providerInputAck?: Promise<boolean>
     providerInputAcknowledged: boolean
   }

   type AssistantAcceptedActiveTurnInputAdmission =
     Omit<
       Extract<AssistantActiveTurnInputAdmissionResult, { kind: 'accepted' }>,
       'providerAlreadySteered'
     > & {
       acceptedInputs: readonly AssistantAcceptedTurnInputItemInput[]
     }
   ```

   Do not introduce a second durable input schema. This private queue holds the
   same accepted admission shape local-service already commits.

   Make `acceptedInputs` required for accepted admissions in the target API and
   remove the `request-${ordinal}` fallback as part of the hard cut. Every
   materializer must produce stable accepted input ids before input can be
   queued, steered, or committed.

   `providerAlreadySteered` is transport state owned by the controller. Remove it
   from materializer output in the target type, or strip it before queueing.
   Boundary drain may emit it only when every item in the admitted prefix has a
   still-current provider acknowledgement.

4. Add an active-input-available signal.

   Local `capture.imported` and hosted wake/nudge paths should notify the active
   turn that same-conversation input may be available. This signal should not
   inspect Telegram/Linq payloads, build prompts, or call Codex directly. It
   should only ask the active controller to run the same live-admission path.

   The existing scanner wake remains as fallback for no active turn, stale turn,
   failed live admission, and provider-closed races.

   This should be a separate exported lookup API, not a reuse of manual
   `enqueue(AssistantMessageInput)`. Manual steering should keep requiring
   `expectedActiveTurnId`. Inbox/mailbox capture events often know only vault and
   conversation, so they need a function shaped like:

   ```ts
   notifyAssistantActiveTurnInputAvailable({
     conversation,
     vault,
   })
   ```

   The function resolves the existing active controller by conversation key and
   lets the controller use its own fenced session and turn ids.

   Local same-process `capture.imported` can call this directly before requesting
   the scanner wake.

   For hosted, prefer a bounded generic live refresh pump over a new hosted
   ping/control route. The current hosted nudge path cannot reach the in-flight
   invocation without a new transport bridge, which would be the most bespoke
   hosted option. The pump is shared controller/runtime behavior:

   - starts only while a steerable live provider turn is registered
   - stops on provider release, controller close, abort, or live-admission budget
   - calls the same admission hook with `phase: "input_available"`
   - uses the controller's singleflight serialization
   - remains unaware of hosted/local/Telegram/Linq/email

   Hosted immediate steering then comes from the pump refreshing the hosted
   `AssistantTurnInputPort`, not from a new Cloudflare route. The existing
   hosted mailbox append plus nudge path remains the durable fallback wake.

5. Keep `AssistantTurnInputPort` as the hosted/local seam.

   - local inbox-backed port: return `no_new_input` from refresh, then list
     captures normally
   - hosted wrapper: import/checkpoint the conversation mailbox lane, then
     delegate listing to the inbox-backed port

   If a port cannot provide the durability required by hosted active input, fail
   closed with the existing unavailable/checkpoint-rejected errors and let the
   wake retry from durable state.

6. Preserve `local-service` as the durable commit path.

   The live path may make input provider-visible earlier, but it must not advance
   auto-reply cursors, mark captures handled, create outbox intents, or dispatch
   delivery. Those remain after accepted input is appended, transcript refs are
   recorded, active-turn checkpoint succeeds, and final outbox commit proceeds.

7. Serialize live admission.

   Duplicate or bursty `capture.imported` notifications can otherwise race
   through the stateful auto-reply materializer before the accepted context has
   advanced. The controller should own a singleflight/admission chain for live
   materialization and queuing. The controller should pass pending exclusions to
   admission as `knownInputIds` and `knownCaptureIds`, derived from queued
   `acceptedInputs`. Captures already queued but not yet committed must be
   excluded from subsequent live admission attempts.

8. Drain one queue at boundaries.

   Boundary admission should drain the same controller queue used by
   `input_available` admission. It should not independently re-materialize
   captures already queued by a live signal and then merge them ahead of manual
   input. Preserve FIFO ordering and split admitted prefixes by provider
   acknowledgement status: only a prefix where every item was acknowledged by the
   still-current live provider can be returned to local-service as
   `providerAlreadySteered: true`.

9. Clean up terminology.

   Reserve "steer" for provider transport. Rename manual-facing controller APIs
   in the target shape around enqueue/notify language:

   - manual input: `enqueueManualActiveTurnInput`
   - inbox/mailbox availability: `notifyAssistantActiveTurnInputAvailable`
   - provider transport acknowledgement: `providerInputAcknowledged`
   - boundary handling: `admitBoundaryInput`

   Existing exported names can remain temporarily as compatibility wrappers only
   while the hard cut is in progress; they should not define the target model.

## Ordering And Failure Semantics

- Live steering is an optimization over accepted input, not a separate semantic
  turn path.
- `providerAlreadySteered` is a local-service compatibility result emitted by
  controller boundary drain. Internally prefer `providerInputAcknowledged`: the
  current live provider turn acknowledged the accepted input. It does not mean
  the input is handled.
- If live steer succeeds and the process crashes before finalization, the safe
  failure mode is replay/retry from inbox or hosted mailbox state. There must be
  no outbox delivery and no handled-capture advancement from the live steer
  alone.
- If live steer fails, the provider closes, or the active turn id mismatches,
  keep the accepted input pending for the existing boundary continuation path
  when possible. If hosted durability failed before acceptance, abort/defer so a
  later wake rebuilds from durable mailbox/workspace truth.
- When calling provider `steer()`, capture the live provider turn object,
  provider session id, and provider turn id. If the live provider turn is
  released, replaced, or the controller closes before the promise resolves, do
  not mark that input acknowledged. It must be replayed through boundary
  continuation instead of being treated as safely seen.
- If hosted mailbox refresh or acceptance checkpoint conflicts, abort the active
  workspace phase. Do not continue sampling, create outbox, or mark cursor state
  advanced.
- Rapid same-conversation captures should preserve capture order and either
  coalesce into one accepted batch or serialize deterministically through the
  same queue. Cursor effects must advance to the latest accepted capture only
  after completion.
- Cross-conversation captures should wake scanning but must not steer the current
  active turn.
- Duplicate capture/import notifications must not produce duplicate accepted
  input ids or duplicate outbox intents.

## Migration Steps

1. Add focused characterization tests for the current delay:
   same-conversation capture is imported during an active Codex provider turn,
   but active admission does not happen until provider boundary.

2. Extract the auto-reply live/boundary materializer from
   `automation/reply.ts`, keeping its output as
   `AssistantActiveTurnInputAdmissionResult`.

3. Collapse active-turn admission and refresh phases to
   `input_available | request_boundary | commit_barrier`, remove provider
   response/request ordinal from admission input, and keep request ordinal only
   on checkpoint input.

4. Hard-cut the controller to one private accepted-admission queue. Convert
   manual input into the same internal accepted snapshot at enqueue time, require
   stable accepted input ids, and remove the target reliance on optional
   `acceptedInputs` fallback ids.

5. Add controller admission serialization, stable accepted-id requirements for
   queued live admissions, provider-owned acknowledgement state, pending
   capture/input exclusions, and still-current-provider validation before
   marking provider input acknowledged.

6. Route local `capture.imported` events into an active-input-available
   notification, before the existing scanner wake fallback.

7. Add the bounded generic live refresh pump for hosted/local parity. Do not add
   a hosted-specific Cloudflare control route unless the pump later proves
   insufficient. Keep mailbox import/checkpoint behavior inside the hosted
   `AssistantTurnInputPort` implementation.

8. Keep boundary admission in place and make it drain the same controller queue,
   so missed events, stale provider turns, and non-steerable providers all share
   the existing continuation path.

9. Delete remaining manual-vs-auto-reply steering special cases that duplicate
   controller queue behavior as part of the hard cut.

## Minimum Verification

- Controller/unit coverage proving manual and inbox accepted admissions drain
  through the same queue and `providerAlreadySteered` is set only after steer
  acknowledgement.
- Controller/unit coverage proving a steer acknowledgement that resolves after
  provider release/replacement or controller close does not set
  `providerAlreadySteered`.
- Controller/unit coverage proving two simultaneous live input signals for the
  same capture produce one queued accepted input id.
- Local-service coverage proving a same-conversation Telegram/Linq capture can
  steer a live Codex turn before provider completion and avoid a second provider
  request when steering succeeds.
- Fallback coverage proving steer failure or provider-close uses the existing
  boundary continuation path without cursor advancement.
- Hosted turn-input coverage proving the live refresh phase imports/checkpoints
  through the same `AssistantTurnInputPort` wrapper before capture listing.
- Hosted pump coverage proving no new Cloudflare public/internal control route
  is required for live input and in-flight hosted nudges still remain a durable
  fallback wake.
- Hosted conflict coverage proving both refresh checkpoint rejection and
  acceptance checkpoint rejection abort without outbox intent, delivery, or
  handled-capture advancement.
- Burst/cross-conversation/duplicate coverage proving ordered same-conversation
  input, no current-turn steering for other conversations, and no duplicate
  accepted input ids.
- Crash-window coverage proving steer-before-finalization cannot produce outbox
  delivery or handled-capture advancement without the existing durable commit
  path.
- Auto-reply context coverage proving materialization alone does not advance the
  accepted group context; context advances only after durable acceptance.
