# Hosted Assistant Input Hard Cut Plan

Status: revised hard-cut plan after stress review
Created: 2026-04-30

## Goal

Hard-cut hosted conversation handling so Codex admission no longer depends on
inbox capture, inbox persistence, parser work, search indexing, attachment
materialization, raw email loading, or runtime-only inbox projection.

The final invariant is:

> A decoded, authenticated, mailbox-matched hosted event is enough to reach
> Codex. Inbox is evidence, search, UI, and enrichment only.

This is a simplification plan. If a proposed step adds a second path, a second
queue, or a second durable identity for the same message, reject it unless the
existing path is deleted in the same batch.

## Simplification Rules

- One durable assistant admission record: `AssistantInputEvent`.
- One source interface for scanner and active-turn admission:
  `AssistantInputSource`.
- One accepted-input journal identity:
  `source: "assistant-input"` with
  `contentRef.kind: "assistant-input-event"`.
- One terminal handling identity: input ids or input group ids.
- Inbox capture ids are projection metadata, never the primary assistant
  identity.
- Projection status lives on the input event as diagnostic/enrichment state.
  Hosted projection is one-shot best-effort after checkpoint unless a future
  executor adds minimized durable reconstruction data; do not add a separate
  projection queue.
- Hosted input does not use runtime-only inbox rows. In greenfield, that bridge
  should be removed instead of quarantined behind another flag.
- Hosted execution is only a thin runner over the local runtime. Once a hosted
  mailbox item is decoded and matched, it must enter the same
  `AssistantInputEvent` spine used by local runtime input.
- Hosted workspace startup must not initialize inbox projection before mailbox
  import or assistant automation. Inbox initialization belongs only inside the
  best-effort projection path after `AssistantInputEvent` staging.
- Greenfield means no permanent compatibility shims and no capture-first
  fallback path kept for comfort.

## Final Shape

```text
local runtime ingress
  -> local inbox/manual/system source adapters

hosted runner ingress
  -> restore local runtime workspace
  -> fetch/decrypt/parse/match hosted mailbox item

both paths
  -> same AssistantInputEvent ingest
  -> assistant-engine AssistantInputEvent store
  -> AssistantInputSource
  -> automation scanner / active-turn admission
  -> accepted-input journal
  -> Codex

  -> best-effort inbox projection after admission staging
  -> parser/search/attachment enrichment
```

The long-term ownership split:

| Layer | Owns | Does not own |
| --- | --- | --- |
| Hosted mailbox | encrypted ingress ordering, dedupe, lane sequence, payload refs | assistant handling, inbox projection success |
| Assistant input store | durable Codex-admission input events | raw provider payloads, raw email, attachment bytes, canonical inbox evidence |
| Accepted-input journal | proof that a turn accepted input event ids | mailbox import, inbox projection durability |
| Inbox | raw inbox evidence, bounded searchable captures, parser jobs, UI/debug enrichment | Codex admission |
| Parser/search/files | derived enrichment | wakeup, admission, or delivery gating |

In one sentence:

> Hosted mailbox is ingress truth, assistant input is Codex admission truth,
> accepted-input journal is turn acceptance truth, and inbox is projection.

## Local And Hosted Runtime Parity

Hosted should not become a second assistant architecture.

The hosted runner may do only the work required to execute local runtime code in
a container:

- restore the encrypted workspace snapshot
- provide platform ports for hosted mailbox, checkpoint, logs, status, usage,
  outbox drain, and narrow web callbacks
- fetch, decrypt, parse, and trust-check hosted mailbox payloads
- inject decoded input into the same local runtime input path
- checkpoint the same local runtime state shape

After a hosted mailbox item becomes a safe `AssistantInputEvent`, scanner,
active-turn admission, accepted-input journaling, prompt construction, terminal
evidence, receipts, and outbox must be identical to local runtime behavior.

Do not add hosted-only versions of:

- assistant input stores
- scanner candidate types
- active-turn input ports
- accepted-input sources
- terminal evidence models
- prompt builders
- runtime-only inbox admission

Hosted mailbox decode is an ingress adapter. It is not an assistant execution
mode.

## What The Inbox Still Does

Keep `inboxd`. It still provides real value:

- canonical raw inbox evidence under `raw/inbox/**`
- append-only bounded capture ledger under `ledger/inbox-captures/**`
- list/show/search surfaces for operators and debugging
- attachment job coordination
- parser handoff and derived inbox artifacts
- producer-side attachment evidence refresh for accepted assistant input events
- deterministic promotion flows from inbox evidence into canonical vault records

Do not keep `inboxd` as:

- hosted Codex admission gate
- mailbox checkpoint authority
- durable assistant input identity owner
- fallback queue for decoded hosted events
- required source for scanner or active-turn selection

## Durable Identity Model

### Assistant Input Event

`AssistantInputEvent` is the one durable unit of assistant admission. It should
cover hosted mailbox messages, inbox-backed local captures, manual inputs, and
future source types without adding parallel candidate models.

The durable type should live with the store, for example in
`packages/assistant-engine/src/assistant/input-store.ts` or a neutral sibling
such as `input-event.ts`. `AssistantInputSource` should depend on that type;
the store must not import durable identity types from the source adapter.

Long-term shape:

```ts
type AssistantInputEvent = {
  schema: "murph.assistant-input-event.v1";
  inputId: string;

  sourceRef:
    | {
        kind: "hosted-mailbox";
        lane: "conversation" | "system";
        laneSeq: string;
        itemId: string;
        dedupeKey: string;
        payloadSource: "inline" | "sidecar";
      }
    | {
        kind: "inbox-capture";
        captureId: string;
      }
    | {
        kind: "manual" | "system";
        refId: string;
      };

  conversationRef: {
    channel: string;
    conversationKey: string;
    participantKey?: string | null;
  };

  content: {
    text: string | null;
    parts: Array<AssistantInputContentPart>;
    summaryForPrompt: string;
    attachmentSummary?: {
      count: number;
      kinds: string[];
      mimeTypes: string[];
      totalBytes?: number | null;
    } | null;
  };

  projection: {
    inboxCaptureId?: string | null;
    status:
      | "not_attempted"
      | "pending"
      | "succeeded"
      | "failed"
      | "quarantined";
    reasonCode?: string | null;
    lastAttemptedAt?: string | null;
  };

  attachmentEvidence: {
    status: "not_attempted" | "available" | "partial" | "failed";
    source: "local-inbox-import" | "local-parser-drain" | "hosted-inbox-projection" | "manual" | null;
    optionalInboxCaptureId: string | null;
    reasonCode: string | null;
    attachments: Array<{
      ordinal: number;
      kind: "image" | "audio" | "video" | "document" | "other";
      mime: string | null;
      fileName: string | null;
      raw?: {
        kind: "vault-relative-file";
        path: string;
      } | null;
      derived?: {
        kind: "parser-manifest";
        manifestPath: string;
        allowedRoot: string;
      } | null;
    }>;
  };

  occurredAt: string;
  storedAt: string;
};
```

The content section is stable prompt-ready input. Projection status can change.
`attachmentEvidence` is mutable materialization state and is not part of
immutable replay identity. It may hold sanitized vault-relative artifact refs
under `raw/inbox/**`, `raw/assistant-input/**`, `derived/inbox/**`, and
`derived/assistant-input/**`, plus bounded safe text fragments. It must not
hold absolute paths, signed URLs, raw hosted payloads, auth headers, provider
request bodies, cookies, or attachment bytes.

`raw/assistant-input/**` is the assistant-owned raw artifact namespace for
input-owned evidence. Producer hooks may copy safe source artifacts there when
they need a filename-neutral handle decoupled from inbox capture layout.

`replyTarget` is the one narrow exception to the no-provider-id rule. It may
carry the private provider thread/message id needed to send a reply, but it is
not a conversation identity, scanner key, prompt identity, search field, or
projection cursor. If `replyTarget` is absent or minimized, Codex still admits
the input; only delivery routing may be deferred.
For hosted email, `replyTarget.threadId` is the serialized private
`hostedmail:` thread authority. The hashed conversation thread remains the
only grouping key.

Attachment descriptors must be minimized. Store kind, MIME type, count, and
size. Store a display name only after it is sanitized, bounded, and needed for
the user-visible prompt.

### Accepted Input Journal

`packages/assistant-engine/src/assistant/active-turn-input-journal.ts` should
record assistant input events directly:

```ts
source: "assistant-input";

contentRef: {
  kind: "assistant-input-event";
  refId: inputId;
  version: "murph.assistant-input-event.v1";
};
```

Do not add `hosted-mailbox` as another accepted-input source. Hosted mailbox
details belong inside `AssistantInputEvent.sourceRef`.

`captureIds` can remain as optional projection links for debugging and
backfill. They must not be required for acceptance, dedupe, terminal evidence,
or provider request assembly.

### Terminal Evidence

Terminal handling evidence must be input-id-aware:

```text
handled(inputId) -> do not process again
handled(inputGroupId, inputIds[]) -> do not process that coalesced group again
```

Capture-id evidence can stay as projection metadata for existing capture-backed
history, but it must not be the only durable proof for a hosted event.

### Hosted Mailbox State

Use the smallest cursor model that preserves correctness:

- `mailboxStagedWatermark` per lane: highest lane seq that has either been
  durably upserted as an `AssistantInputEvent` and checkpointed, or permanently
  quarantined before input creation.
- projection status: fields on each `AssistantInputEvent.projection`.

Do not add a separate assistant-input queue. Do not add a separate projection
queue. `pending` and `failed` projection states are diagnostic/enrichment state,
not a durable retry contract.

Mailbox staging and Codex turn acceptance are different facts:

- mailbox staging says the runtime durably has a safe input event
- accepted-input journal says a turn accepted that input
- terminal evidence says automation is done with it
- projection status says inbox/search enrichment did or did not happen

## Failure Semantics

### Before Assistant Input Durability

Fail closed and create no input event when the payload is not safe assistant
input:

- wrong user or workspace
- mailbox lane gap that prevents ordered processing
- payload fetch failure with no authenticated payload
- decrypt failure
- parse or contract validation failure
- wake does not match the mailbox item
- unsafe minimized content shape
- workspace checkpoint conflict

Retryable pre-input failures do not advance `mailboxStagedWatermark`.

Authenticated but permanently invalid items may be quarantined in mailbox state
so one bad item does not block the lane forever. Quarantine is not assistant
acceptance and does not create an assistant input event.

### After Assistant Input Durability

Fail open once the input event is durable:

- canonical inbox persistence failure
- attachment download or materialization failure
- raw email body fetch failure
- parser failure
- search/index failure
- inbox projection timeout

Fail open means Codex can see the assistant input event and the projection
failure. It does not mean projection succeeded, and it does not create a hidden
runtime-only inbox row.

## Email Boundary

Email currently has the most important greenfield decision.

If hosted email must reach Codex without raw EML loading, the hosted mailbox
payload needs enough safe minimized metadata to create an `AssistantInputEvent`
before raw email fetch:

- inbox identity
- message id or serialized private thread reply target
- sender/recipient summary
- subject when safe and bounded
- bounded preview/body text if already available from ingress
- attachment count/kinds, not filenames or bytes by default

If that minimized data is unavailable, the event should become a metadata-only
assistant input with projection marked `pending` or `failed`, not a capture-gated
path that waits for raw email. Raw EML and body-derived rich text are projection
enrichment.

## Implementation Batches

### Batch 1: Rebase Engine Primitives

Purpose: make the engine input model source-neutral before hosted ingest changes
depend on it.

Files:

- `packages/assistant-engine/src/assistant/input-store.ts`
- `packages/assistant-engine/src/assistant/input-source.ts`
- `packages/assistant-engine/src/assistant/active-turn-input-journal.ts`
- `packages/assistant-engine/src/assistant/automation/evidence.ts`
- directly coupled assistant-engine tests

Changes:

- Move durable input-event types into the store or a neutral input-event module.
- Make `AssistantInputEvent` the only candidate identity.
- Add store-backed `AssistantInputSource`.
- Change inbox-backed input handling to upsert/read `AssistantInputEvent`
  records instead of bypassing the store with capture summaries.
- Add accepted-input journal support for
  `source: "assistant-input"` and `contentRef.kind: "assistant-input-event"`.
- Add terminal evidence support for `inputId`, `inputGroupId`, and `inputIds`.
- Keep projection status on the input event without adding a retry listing or
  queue.

Required tests:

- capture-less assistant input event can be stored, listed, accepted, and marked
  terminal
- inbox capture can be represented as an assistant input event
- accepted input with zero capture ids round trips
- terminal evidence dedupes by input id and input group id
- failed projection remains listable as diagnostic state
- malformed assistant input refs fail closed

### Batch 2: Hard-Cut Hosted Ingest

Purpose: decoded hosted messages become assistant input before local inbox or
attachment work can fail, while still entering the same runtime input spine as
local input.

Files:

- `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-state.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-checkpoint.ts`
- directly coupled assistant-runtime tests

Final flow:

```text
resolve payload
  -> decrypt
  -> parse wake
  -> verify wake matches mailbox item
  -> build minimized AssistantInputEvent
  -> upsert input event
  -> checkpoint mailboxStagedWatermark
  -> attempt inbox projection best effort
  -> update input event projection status
```

The input event must be upserted before:

- local runtime context prep
- raw email fetch
- attachment download
- canonical inbox persistence
- parser drain
- search indexing

Changes:

- Merge hosted import inversion and cursor split into one batch.
- Treat hosted mailbox decode as a source adapter for the local runtime input
  model, not a hosted-only assistant path.
- Replace the old import-result-as-capture gate with durable input-event
  staging.
- Use `mailboxStagedWatermark` for decoded/matched input durability, not
  projection success.
- Mark retryable pre-input failures without advancing the staged watermark.
- Quarantine authenticated permanent invalid items in mailbox state, without
  creating input events.
- Record projection success/failure on the input event.

Required tests:

- Linq hosted message creates an input event before inbox projection
- Telegram hosted message creates an input event before attachment work
- email metadata creates an input event even when raw email fetch later fails
- canonical inbox persistence failure records projection failure but leaves the
  input visible to `AssistantInputSource`
- attachment normalization timeout records projection failure
- duplicate mailbox retry dedupes by input id
- decrypt/parse/match failure creates no input event
- permanent authenticated mismatch can quarantine without accepting input
- retryable pre-input failure does not advance `mailboxStagedWatermark`
- user/workspace mismatch remains fail-closed

### Batch 3: Hard-Switch Engine Admission

Purpose: scanner, prompt prep, active-turn admission, receipts, and terminal
evidence all consume assistant input events. Do this as one hard switch so the
capture-first path does not survive and hosted/local admission share the same
engine code.

Files:

- `packages/assistant-engine/src/assistant/automation/scanner.ts`
- `packages/assistant-engine/src/assistant/automation/reply.ts`
- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
- `packages/assistant-engine/src/assistant/automation/evidence.ts`
- `packages/assistant-engine/src/assistant/turn-input.ts`
- `packages/assistant-runtime/src/hosted-runtime/turn-input.ts`
- directly coupled assistant-engine and assistant-runtime tests

Changes:

- Replace direct `inboxServices.list` candidate enumeration.
- Replace `listNewConversationCaptures` with input-event listing.
- Build prompts from `AssistantInputEvent.content` first.
- Build prompts from event-owned `attachmentEvidence`; prompt construction must
  not call `inboxServices.show`.
- Use `inboxServices.show` only in producer/update paths that refresh
  `attachmentEvidence` after capture import or parser drain.
- Include projection failure context in prompts without leaking raw payloads.
- Attach accepted input event ids to provider requests and receipts.
- Admit capture-less hosted late input into in-flight Codex turns.
- Move active-turn errors and phases to source-neutral naming, then delete the
  capture-only port.

Required tests:

- initial scanner selects hosted input with no capture
- local inbox-backed input and hosted mailbox-backed input use the same
  `AssistantInputSource` contract
- scanner still handles inbox-backed events through the input store
- prompt can be built from hosted input text without inbox capture
- prompt uses event-owned `attachmentEvidence` after producer-side refresh,
  without prompt-time inbox service calls
- projection failure does not hide the candidate
- terminal evidence prevents duplicate processing by input id
- late hosted input with no capture is steered into an active Codex turn
- known input ids suppress duplicates
- checkpoint rejection prevents delivery rather than silently accepting input

### Batch 4: Delete Bridges And Compatibility Residue

Purpose: remove the old abstractions rather than carrying both architectures.

Delete or verify absent:

- capture-only `AssistantTurnInputPort`
- `createInboxBackedAssistantTurnInputPort`
- `listNewConversationCaptures`
- direct scanner use of `inboxServices.list`
- hosted transient capture staging
- hosted hidden-row inbox wrappers
- hosted `createHostedTurnInputInboxServices`
- hosted automation inbox identity wrappers
- accepted-journal cursor effects for mailbox/import/capture cursors
- tests whose only purpose is proving transient hosted capture admission

Required residue scans:

```sh
rg "listNewConversationCaptures|AssistantTurnInputPort" packages apps
rg "stageRuntimeOnlyCapture|includeRuntimeOnly|capture_persistence|runtime_only" packages apps
rg "cursorEffects|auto-reply-channel|inbox-scan" packages apps
rg "inboxServices\\.list" packages/assistant-engine/src/assistant/automation
```

## Parallel Work Plan

Keep the batches simple:

1. Batch 1 is the contract lock. Do it first.
2. Batch 2 and Batch 3 can proceed in parallel after Batch 1 lands if they
   agree on the final `AssistantInputEvent` and `AssistantInputSource` APIs.
3. Batch 4 is serial cleanup after Batch 2 and Batch 3 are green.

Suggested worker split after Batch 1:

| Worker | Owns | Must not edit |
| --- | --- | --- |
| Hosted ingest | `packages/assistant-runtime/src/hosted-runtime/**` import/checkpoint/projection code and tests | scanner, prompt builder, accepted journal |
| Engine admission | scanner, reply prompt prep, active-turn admission, terminal evidence tests | hosted mailbox import/checkpoint code |
| Cleanup/verification | residue scans, docs, final integration tests after both land | live implementation files until both owners finish |

## Non-Goals

- Do not delete `inboxd`.
- Do not make Cloudflare the durable assistant-input owner.
- Do not store raw hosted payloads, raw EML, signed URLs, absolute/local paths,
  auth headers, provider request bodies, cookies, or attachment bytes in
  assistant input events. The only path exception is sanitized vault-relative
  attachment-evidence refs under the approved `raw/**` and `derived/**` roots.
- Do not add a hosted-runtime-input journal beside `AssistantInputEvent`.
- Do not add a projection queue beside the input store.
- Do not reintroduce runtime-only inbox rows as assistant state.
- Do not keep parallel capture-first and input-first architectures long term.

## Privacy And Data Minimization Rules

Assistant input events may store:

- bounded user-visible message text
- bounded prompt text or transcript text
- minimized message content parts
- minimized attachment descriptors
- opaque source ids
- conversation refs
- projection status and reason codes

Assistant input events must not store:

- raw mailbox ciphertext
- raw provider payloads
- raw EML
- signed URLs
- local filesystem paths
- auth headers
- cookies
- provider request/response bodies
- attachment bytes
- unbounded message bodies
- unsanitized attachment filenames

## Greenfield End State

The final package boundaries should read:

```text
apps/web
  owns hosted mailbox rows and product/control-plane facts

packages/assistant-runtime
  owns local runtime orchestration, source adapters, hosted mailbox decode as
  an ingress adapter, trust-boundary validation, input-event staging, and inbox
  one-shot best-effort projection after checkpoint

packages/assistant-engine
  owns AssistantInputEvent store, AssistantInputSource, source-neutral
  selection, accepted-input journal, terminal evidence, turn admission, prompt
  construction, provider execution, receipts, and outbox

packages/inboxd
  owns inbox evidence, capture projection, search, parser coordination, and
  promotion support
```

## Completion Criteria

This hard cut is complete when:

- a valid hosted Linq message reaches Codex with no inbox capture row
- a valid hosted Telegram message reaches Codex with no inbox capture row
- a valid hosted email metadata event reaches Codex even if raw email body
  projection fails
- canonical inbox projection failure records projection status without blocking
  scanner selection
- active-turn hosted input steers Codex without a runtime-only inbox row
- accepted-input journal records assistant input ids directly
- terminal evidence dedupes by assistant input id or input group id
- hosted code has no transient inbox staging dependency
- production code has no dependency on `listNewConversationCaptures`
- no mailbox or assistant cursor advances because of runtime-only projection
- inbox capture remains usable as producer-side evidence when projection
  succeeds, but prompt construction reads the assistant input event only

## Final Stress Checklist

Use this checklist before landing implementation:

- Does any Codex-admitted input bypass `AssistantInputEvent`?
- Does scanner or active-turn admission call inbox list directly?
- Does the accepted-input journal mention hosted mailbox as a separate source
  instead of assistant input?
- Can terminal evidence dedupe a capture-less input?
- Does any projection failure prevent candidate listing?
- Does any raw email fetch happen before input event staging?
- Are attachment descriptors minimized and filename-safe?
- Can one permanent malformed mailbox item avoid blocking the lane forever
  without becoming assistant input?
- Are runtime-only inbox rows gone from assistant admission code?
- Did the implementation delete the old capture-first path instead of keeping
  it as a fallback?
