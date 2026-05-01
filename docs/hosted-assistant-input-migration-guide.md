# Hosted Assistant Input Migration Guide

Status snapshot: 2026-04-30

## Purpose

This document defines the greenfield hard-cut path for decoupling Codex from
inbox capture. There is no old persisted data to preserve for this cut, so the
implementation should delete vestigial capture-gated paths instead of adding
compatibility shims.

The goal is not to make Codex consume transient, uncheckpointed raw events. The
goal is to move the durable input boundary earlier and simpler:

```text
hosted mailbox log
  -> assistant input ingest
  -> assistant input store
  -> assistant input source
  -> Codex / accepted input journal / handling ledger

assistant input store
  -> inbox/search/file/parser projections
```

The key rule is:

> Codex consumes durable assistant input events. Inbox is a projection.

## Problem Statement

Hosted conversation messages currently pass through a capture-first path before
they become usable by assistant automation.

That makes the assistant path depend on projection work:

- source-specific capture normalization
- hosted raw email loading
- attachment download or materialization
- canonical inbox persistence
- transient capture fallback
- parser drain and prompt enrichment
- inbox list/show/search semantics

Those steps are useful, but they should not decide whether Codex learns that a
trusted hosted message exists.

The target architecture separates three facts:

1. A hosted mailbox item was fetched, decrypted, validated, and matched.
2. Codex accepted that input into a recoverable assistant turn or handling
   decision.
3. Inbox/search/file/parser projections were built.

Today those facts are too close together.

## Desired Invariant

A hosted conversation message may become Codex input when all of these are
true:

1. The mailbox item belongs to the expected hosted user/workspace.
2. Its payload was resolved from inline storage or sidecar storage.
3. Its payload decrypted and parsed as the expected hosted wake schema.
4. The decoded wake matches the mailbox envelope by kind, user, occurred time,
   and event/dedupe identity.
5. A durable `AssistantInputEvent` was written and checkpointed.

No inbox capture row is required for that input to reach Codex.

No user-visible side effect is allowed until accepted input and reply intent are
durably committed.

## Target Components

### 1. Hosted Mailbox

The hosted mailbox remains the encrypted ingress log.

Responsibilities:

- append one ordered mailbox item per product/control-plane event
- allocate per-lane sequence numbers
- preserve dedupe identity
- store payload inline or by encrypted sidecar reference
- make rows fetchable by the hosted runtime after workspace restore

Non-responsibilities:

- assistant turn/session state
- Codex input acceptance
- reply handling outcome
- inbox/search projection completion
- per-message assistant completion state

### 2. Assistant Input Store

The assistant input store is the new durable boundary between hosted ingress
and Codex.

It is local assistant runtime state, not canonical inbox evidence. It belongs
under assistant runtime state, such as:

```text
.runtime/operations/assistant/input-events/
```

It must be preserved by hosted workspace checkpoints because it is the recovery
source for provider-visible assistant input.

The store is durable operational state. It is not user-facing memory, product
truth, search state, or a web-owned control-plane table.

### 3. Assistant Input Event

An `AssistantInputEvent` is the normalized, source-agnostic event Codex can
consume.

Suggested shape:

```ts
type AssistantInputEvent = {
  schema: "murph.assistant-input-event.v1";
  inputId: string;

  sourceRef: {
    kind: "hosted-mailbox-item";
    lane: "conversation" | "system";
    laneSeq: string;
    itemId: string;
    eventId: string;
    dedupeKey: string;
    payloadSource: "inline" | "sidecar";
    payloadSchema: string;
  };

  occurredAt: string;
  storedAt: string;

  conversation:
    | {
        kind: "conversation";
        channel: "linq" | "telegram" | "email";
        ref: AssistantConversationRef;
        direct: boolean;
      }
    | null;

  content: {
    text: string | null;
    transcriptText: string | null;
    userMessageContent: AssistantUserMessageContentPart[] | null;
    attachmentDescriptors: readonly AssistantInputAttachmentDescriptor[];
  };

  replyTarget: {
    channel: "linq" | "telegram" | "email";
    threadId?: string | null; // private route authority; hosted email uses hostedmail:
    deliveryReplyToMessageId?: string | null;
    deliverySource?: Record<string, string> | null;
  } | null;

  projection: {
    inboxCaptureId: string | null;
    status: "not_attempted" | "pending" | "succeeded" | "failed" | "quarantined";
    reasonCode: string | null;
    lastAttemptedAt: string | null;
  };
};
```

The exact type names can change during implementation. The required properties
are stable identity, source reference, ordered cursor fields, conversation
reference, prompt-ready content, reply target metadata, and projection status.

### 4. Assistant Input Source

The assistant engine should consume an input-source abstraction instead of
directly consuming inbox captures.

Suggested shape:

```ts
interface AssistantInputSource {
  refresh(input: AssistantInputRefreshInput): Promise<AssistantInputRefreshResult>;

  listAutomationCandidates(
    input: AssistantAutomationCandidateQuery,
  ): Promise<AssistantInputCandidateBatch>;

  listNewConversationInputs(
    input: AssistantTurnConversationInputQuery,
  ): Promise<AssistantInputCandidateBatch>;

  checkpointAcceptedInput?(
    input: AssistantActiveTurnInputCheckpointInput,
  ): Promise<void>;
}
```

`AssistantInputCandidate` should be engine-neutral:

```ts
type AssistantInputCandidate = {
  inputId: string;
  sourceRef: AssistantInputSourceRef;
  occurredAt: string;
  orderingCursor: AssistantInputCursor;
  conversation: AssistantConversationRef;
  channel: "linq" | "telegram" | "email";
  direct: boolean;
  prompt: string;
  transcriptText: string | null;
  userMessageContent: AssistantUserMessageContentPart[] | null;
  acceptedInput: AssistantAcceptedTurnInputItemInput;
  replyTarget: AssistantReplyTarget | null;
  projection: {
    inboxCaptureId: string | null;
    status: AssistantInputProjectionStatus;
  };
};
```

Inbox-backed inputs and hosted-mailbox inputs both adapt into this shape.
Assistant automation should not branch on `InboxCapture` versus hosted wake.

### 5. Accepted Input Journal

The accepted input journal remains the record of provider-visible assistant
input. It needs source/input refs rather than capture-only refs.

Required changes:

- add accepted input source such as `"assistant-input"` or `"hosted-mailbox"`
- add content ref kind such as `"assistant-input-event"`
- allow `captureIds` to be empty or optional when an inbox projection is absent
- extend hosted mailbox cursor effects to record item/input ids, not only
  capture ids

The journal should not persist plaintext prompt bodies or raw provider payloads.
It should store refs, versions, length buckets, and source cursor effects.

### 6. Assistant Handling Ledger

Assistant handling state should be keyed by `inputId` or a stable group of
`inputId`s.

Responsibilities:

- terminal evidence for suppressed/deferred/replied inputs
- accepted input grouping
- reply intent state
- delivery idempotency keys
- delivery receipt/reconciliation metadata
- provider watchdog state

Capture ids may be copied into handling records as projection metadata, but
they must not be required for handling correctness.

### 7. Inbox Projection

Inbox stays, but it is demoted.

Responsibilities:

- searchable message/capture history
- human/operator inspection
- normalized source fields
- raw evidence indexing
- attachment/file/parser materialization
- UI read models
- query acceleration
- debugging and audit views

Non-responsibilities:

- deciding whether Codex sees a hosted message
- being the only key for assistant handling evidence
- advancing assistant input cursors
- representing transient runtime-only assistant input

## Greenfield Flow

### Initial Hosted Message

```text
1. Provider webhook commits product/control-plane state.
2. Web appends encrypted hosted mailbox item in the same transaction.
3. Web nudges the Cloudflare runner.
4. Runner restores hosted workspace.
5. Runtime fetches mailbox prefix after ingest cursor.
6. Runtime resolves inline or sidecar payload.
7. Runtime decrypts, parses, and validates hosted wake.
8. Runtime verifies decoded wake matches mailbox item.
9. Runtime writes AssistantInputEvent.
10. Runtime advances ingest cursor after the input event is checkpointed.
11. Assistant input source lists candidates for automation.
12. Codex receives prompt/content derived from AssistantInputEvent.
13. Accepted input journal records the input id and source ref.
14. Reply intent is durably committed before provider delivery.
15. Inbox/search/files/parser projections run best-effort.
```

### Active Turn Message

```text
1. New hosted message arrives while Codex is running.
2. Active-turn refresh fetches and ingests mailbox rows.
3. New AssistantInputEvent is written and checkpointed.
4. Active-turn admission lists new conversation inputs by input id.
5. Provider is steered with prompt/content for the new input.
6. Accepted input checkpoint commits before final reply intent creation.
```

### Projection Failure

```text
1. AssistantInputEvent is durable.
2. Inbox projection fails or times out.
3. Projection status records reason code and retry metadata.
4. Assistant input remains listable.
5. Codex prompt includes enough source metadata to explain that inbox/search may lag.
6. Projection retries independently.
```

Projection failure is not `source_unavailable` for Codex once the assistant
input event exists.

## Cursor And State Model

Use separate state for separate truths.

### Mailbox Ingest Cursor

Means:

> Mailbox items through this lane sequence have been decoded into durable
> assistant input events, skipped as already-ingested, or quarantined
> non-retryably.

Does not mean:

- inbox projection succeeded
- Codex accepted the input
- assistant replied
- cleanup ran

### Assistant Handling State

Means:

> Inputs have reached a terminal assistant-handling outcome.

Possible terminal outcomes:

- accepted into a turn and replied
- accepted into a turn and explicitly suppressed
- accepted into a turn and deferred with durable reason
- quarantined before assistant admission
- failed with a durable retry policy

### Projection State

Means:

> Inbox/search/file/parser projection has succeeded, failed retryably, failed
> non-retryably, or is pending.

Projection state must not block mailbox ingest or assistant handling unless the
reply path explicitly depends on that projection data.

## Failure Boundaries

### Fail Closed

Fail closed before creating an assistant input event when:

- mailbox item user/workspace does not match the restored workspace
- lane sequence has a gap or corrupt value
- sidecar payload is missing, mismatched, or unavailable
- payload cannot decrypt or authenticate
- payload cannot parse as the expected schema
- decoded wake kind does not match the mailbox route
- decoded wake does not match mailbox user, occurred time, or event identity
- workspace checkpoint CAS fails
- active-turn accepted-input checkpoint is rejected
- reply intent cannot be durably committed

### Fail Open

Fail open after assistant input event durability when:

- inbox canonical persistence fails
- source-specific capture normalization fails
- attachment download/materialization fails
- raw email fetch fails after enough safe metadata exists for a supported
  metadata-only assistant input
- parser drain fails
- search indexing fails
- provider-visible cleanup fails
- redacted logging/status projection fails

Fail open here means Codex can still see the durable assistant input. It does
not mean provider delivery is allowed without accepted-input and reply-intent
durability.

## Transient Inbox Rows

Transient inbox rows are not part of the final architecture.

In the greenfield hard cut, decoded hosted input goes directly to
`AssistantInputEvent`. Inbox rows are canonical projection rows only; a
transient inbox row must not influence reply eligibility, cursor advancement,
terminal evidence, or active-turn admission.

Removal target:

- no assistant scanner candidate depends on transient inbox persistence
- no active-turn admission requires transient inbox rows
- no terminal evidence is keyed only by transient capture ids
- no mailbox cursor advancement depends on transient projection rows

## Source-Specific Adapters

### Linq First

Linq is the best first implementation target because the hosted wake contains
enough direct-message data for assistant input without inbox capture.

The Linq adapter should derive:

- stable input id from mailbox item id or event id
- channel: `linq`
- conversation/thread ref from chat id
- directness from the Linq message context
- sender/actor ref from the inbound participant or sender id
- text from message parts
- link and attachment descriptors from message parts
- delivery reply-to id from the Linq message id
- accepted input source ref from mailbox lane and sequence

The adapter should not require attachment bytes before Codex can see the input.
Attachment bytes and transcripts are projection/enrichment.

### Telegram Second

Telegram should use the same assistant input event shape, but it needs a
careful adapter for:

- reply metadata
- media group metadata
- attachment descriptors
- optional downloaded media references
- source-specific prompt context currently loaded from inbox envelope metadata

Telegram should not be considered complete until late active-turn inputs and
initial automation both use the same input-source path.

### Email Third

Email is hardest because useful reply context often requires raw EML parsing.

Greenfield rule:

- If the hosted wake includes enough body/thread/identity/reply metadata,
  including a serialized `hostedmail:` reply target, build an email assistant
  input event directly.
- If it only contains a raw-message pointer, ingest can record a pending input,
  but reply admission should wait for safe body/thread/reply extraction or
  produce a durable deferral.

Do not let email raw-message fetch failure become an inbox-gated hidden path.
Either the assistant input event is prompt-ready, or it is durably deferred with
a reason.

## Migration Plan

### Phase 1: Define The Engine Contract

Add engine-level types for:

- `AssistantInputSourceRef`
- `AssistantInputEvent`
- `AssistantInputCandidate`
- `AssistantInputSource`
- `AssistantInputCursor`
- `AssistantInputProjectionStatus`

The assistant engine should not import hosted-runtime wake types. Runtime
adapters convert hosted and inbox inputs into the engine contract.

Exit criteria:

- scanner and active-turn code can be typed against input candidates rather
  than inbox capture summaries
- inbox-backed implementation exists as an adapter
- tests prove an inbox capture can still become an assistant input candidate

### Phase 2: Add Assistant Input Store

Add a durable assistant runtime state store with:

- versioned schema
- deterministic input id
- idempotent upsert by source ref
- list by conversation/order cursor
- projection status update
- accepted/handled lookup helpers

Recommended persisted-state classification:

- root: `.runtime/operations/assistant/**`
- class: durable local operational state
- portability: portable in hosted workspace snapshots
- plaintext policy: no provider secrets, no full auth headers, no unnecessary
  raw payload duplication

Exit criteria:

- validated hosted input can be stored and read after simulated restore
- duplicate source refs dedupe to one input event
- corrupt records fail closed or quarantine at read boundary

### Phase 3: Ingest Hosted Mailbox Into Assistant Input Events

At the hosted conversation mailbox import seam:

1. Resolve payload.
2. Decode payload.
3. Verify wake matches mailbox item.
4. Write `AssistantInputEvent`.
5. Advance ingest cursor only after durable checkpoint.
6. Attempt inbox projection best-effort.

This replaces the capture-first gate.

Exit criteria:

- Linq hosted message creates `AssistantInputEvent` before inbox projection
- canonical inbox persistence failure records projection failure but leaves the
  input listable
- decrypt/parse/match failures do not create assistant input events

### Phase 4: Refactor Automation Scanner

Change initial automation from capture scanning to input-source scanning.

The scanner should:

- list assistant input candidates
- group by conversation/directness/channel policy
- skip candidates with terminal handling evidence
- build accepted input items from candidate source refs
- not require capture ids

Exit criteria:

- initial automation can select a Linq assistant input event with no inbox
  capture
- terminal evidence keyed by input id prevents duplicate handling
- capture-backed candidates still work through the inbox adapter

### Phase 5: Refactor Active-Turn Input

Change active-turn refresh/admission from capture listing to assistant input
listing.

The active-turn path should:

- refresh mailbox into assistant input events
- list late conversation inputs by input cursor
- dedupe by input id
- steer provider with prompt/content from the candidate
- checkpoint accepted inputs before final reply intent creation

Exit criteria:

- late Linq message reaches live Codex turn with no inbox capture
- checkpoint conflict aborts before delivery
- repeated refreshes do not duplicate accepted input

### Phase 6: Extend Accepted Input Journal And Handling Evidence

Update accepted input and terminal evidence to use source/input refs.

Required changes:

- source kind for assistant input events
- content ref kind for assistant input events
- source-ref cursor effects with mailbox lane/seq and input ids
- terminal evidence paths keyed by input id or handling group id
- backward compatibility reader for capture-keyed evidence during migration if
  needed

Exit criteria:

- accepted input journal can validate a hosted input event without capture ids
- terminal evidence can prove a hosted input event is handled
- receipts and delivery reconciliation do not require capture ids

### Phase 7: Demote Inbox To Projection

Move inbox work behind the post-checkpoint best-effort projection path:

- canonical capture persistence
- source-specific normalized capture rows
- search indexing
- attachment materialization
- parser drain
- UI read models

Projection status belongs on the assistant input event. `pending` and `failed`
are diagnostic/enrichment state in the hosted path, not a durable retry queue.

Exit criteria:

- projection failure does not block assistant input listing
- a successful one-shot projection can update `inboxCaptureId`
- normal inbox UI/search still works when projection succeeds

### Phase 8: Remove Runtime-Only Capture From Reply Path

After raw assistant input events are in use:

- remove hosted automation dependence on runtime-only list/show semantics
- remove active-turn dependence on runtime-only capture rows
- keep runtime-only rows only if a debug/preview use remains
- otherwise delete the primitive

Exit criteria:

- no reply path requires runtime-only capture persistence
- no mailbox cursor uses runtime-only projection as import success
- tests fail if a runtime-only row is the only durable assistant input

## Code Stress-Test Checklist

Use this checklist before implementing each phase.

## Current Code Stress-Test Findings

The final hard cut should leave these properties true:

- Hosted conversation import decodes and matches the wake, writes an
  `AssistantInputEvent`, and only then attempts inbox projection.
- Scanner and active-turn admission read `AssistantInputSource`, not an
  inbox-capture-specific listing interface.
- Accepted input journal entries use `source: "assistant-input"` and
  `contentRef.kind: "assistant-input-event"`.
- Terminal reply/deferred/suppression evidence is keyed by assistant input ids;
  capture ids are optional projection metadata.
- Setup/channel priming reads assistant automation state and defaults, not
  `.runtime/operations/inbox/config.json`.
- Runtime-only inbox rows are not part of assistant admission.

### Hosted Mailbox Import

Check:

- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-checkpoint.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-state.ts`

Questions:

- Does any projection exception still skip assistant phase?
- Does any cursor advance before assistant input event durability?
- Are checkpoint conflicts still fail-closed?
- Are decode/match failures still rejected before input creation?
- Is duplicate source ref ingestion idempotent?

### Assistant Engine Input

Check:

- `packages/assistant-engine/src/assistant/turn-input.ts`
- `packages/assistant-engine/src/assistant/automation/scanner.ts`
- `packages/assistant-engine/src/assistant/automation/reply.ts`
- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
- `packages/assistant-engine/src/assistant/local-service.ts`
- `packages/assistant-engine/src/assistant/active-turn-input-journal.ts`

Questions:

- Does scanner depend on inbox `list`?
- Does active-turn input depend on capture ids?
- Can accepted input journal represent a hosted assistant input event?
- Can prompt building use candidate content without loading inbox show?
- Is delivery blocked until accepted input and reply intent are committed?

### Handling Evidence

Check:

- `packages/assistant-engine/src/assistant/automation/evidence.ts`
- receipt and delivery matching in `automation/reply.ts`
- provider watchdog state
- outbox intent idempotency keys

Questions:

- Is terminal evidence keyed by input id or source ref?
- Can grouped handling cover multiple input ids?
- Can capture ids be absent?
- Are legacy capture-keyed records read only as compatibility state?

### Inbox Projection

Check:

- `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`
- `packages/inboxd/src/kernel/pipeline.ts`
- `packages/inboxd/src/kernel/sqlite.ts`
- `packages/inboxd/src/indexing/persist/canonical-records.ts`

Questions:

- Is projection allowed to fail without hiding assistant input?
- Is text bounded only in projection records?
- Are attachment/parser failures projection failures, not input failures?
- Are runtime-only rows absent from reply eligibility?

## Required Tests

### Ingest And Durability

- Linq hosted mailbox item creates an assistant input event after
  decode/match.
- Duplicate mailbox item retry dedupes to the same input id.
- Workspace restore preserves assistant input events.
- Payload sidecar unavailable blocks input creation.
- Payload decode mismatch blocks input creation.

### Projection Failure

- Canonical inbox persistence throws, projection status is `failed`, and the
  input remains listable.
- Runtime-only staging throws, input remains listable.
- Attachment download times out, prompt contains attachment descriptors and
  projection status records timeout.
- Long text remains available to assistant input while inbox projection text is
  bounded.

### Automation

- Initial scanner selects a Linq assistant input candidate with no inbox
  capture.
- Terminal evidence keyed by input id prevents duplicate reply.
- Scanner still handles inbox-backed candidates through the adapter.
- Capture projection arriving later updates metadata without causing a second
  reply.

### Active Turn

- Late hosted Linq input refresh writes input event and steers Codex.
- Active-turn checkpoint conflict aborts before outbox intent creation.
- Repeated refresh before checkpoint does not duplicate accepted input.
- Accepted input ids are recorded before provider-visible delivery.

### Source Adapters

- Linq direct chat derives conversation ref, prompt text, and reply-to id from
  hosted wake data.
- Telegram adapter preserves reply/media metadata before enabling reply
  delivery.
- Email adapter defers safely when raw EML/body/thread context is unavailable.

## Migration Safety Rules

- Do not mark runtime-only capture persistence as imported just to advance a
  cursor.
- Do not store raw provider payloads in accepted input journal.
- Do not add web-owned per-message assistant completion state.
- Do not make Cloudflare own assistant input adoption.
- Do not let inbox search/list availability decide whether Codex sees a
  decoded hosted message.
- Do not allow delivery without durable accepted input and reply intent.

## Documentation Updates Needed During Implementation

When implementation starts, update these live docs alongside code:

- `ARCHITECTURE.md`: describe `AssistantInputStore` as assistant runtime
  operational state and demote inbox to projection for hosted assistant input.
- `agent-docs/references/hosted-runtime-protocol.md`: replace capture-first
  import wording with assistant-input ingest wording.
- `packages/assistant-runtime/README.md`: remove runtime-only capture as the
  primary fallback model.
- `packages/inboxd/README.md`: clarify that inbox is a projection/query surface
  for assistant input, not the Codex admission gate.
- `agent-docs/references/testing-ci-map.md`: add focused coverage expectations
  once package tests exist.

## Open Decisions

1. Should `AssistantInputStore` be JSON files, SQLite, or a small append-only
   JSONL plus index?

   Recommendation: start with versioned JSON records keyed by deterministic
   input id unless list/query performance needs SQLite. The first implementation
   needs correctness and snapshot portability more than complex querying.

2. Should assistant input events store full text?

   Recommendation: store the prompt-ready text needed for Codex, with explicit
   size policy and no secrets. Projection records can keep smaller bounded text
   for search. If unbounded provider payload is needed, store a payload ref, not
   a duplicate blob in the input event.

3. Should email support metadata-only input?

   Recommendation: only if the event has enough safe body/thread/reply context
   for the assistant to reason without fabricating. Otherwise ingest a pending
   event and defer reply handling durably.

4. Should existing capture-keyed evidence be migrated?

   No. This cut is greenfield. New evidence is keyed by input id, and old
   capture-keyed assistant admission state should not shape the new runtime.

## Long-Term Shape

The simplified architecture is:

```text
apps/web
  owns hosted product/control-plane facts and encrypted mailbox ingress

apps/cloudflare
  owns runner coordination, container invocation, and encrypted object plumbing

packages/assistant-runtime
  owns assistant input ingest, assistant input store, one-shot best-effort
  projection after checkpoint, and hosted checkpoint timing

packages/assistant-engine
  owns source-agnostic assistant input selection, accepted input journal,
  handling evidence, reply intent, and delivery policy

packages/inboxd
  owns capture/search/file/parser projections for UI, audit, and query
```

Codex no longer depends on inbox being healthy. Codex also does not depend on
transient raw events. It consumes durable assistant input events.
