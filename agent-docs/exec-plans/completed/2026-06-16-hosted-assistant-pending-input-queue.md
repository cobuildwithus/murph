# Hosted assistant foreground input simplification plan

Status: completed
Created: 2026-06-16
Updated: 2026-06-17

## Goal

Remove the hosted foreground provider-start history scan while preserving the
hard product invariant:

Once a hosted conversation user input is staged as an `AssistantInputEvent`, it
must not be silently dropped. It remains eligible for assistant processing until
complete auto-reply terminal evidence exists for that input, or for every input
in its terminal group.

## First-principles decision

A durable pending ID index is necessary, but a metadata-bearing pending queue is
larger than needed.

Using only fresh mailbox import IDs is not sufficient. `fetchAndProcessHostedMailboxPrefix`
only returns `assistantInputIds` for items imported in the current fetch loop and
advances the local lane watermark after an imported outcome. If input A was
staged earlier and still has no terminal evidence, fresh input B will not
rediscover A unless A is represented somewhere outside the current import result.

Do not solve this by holding the mailbox import watermark until reply completion.
That would make mailbox import state depend on assistant reply lifecycle,
repeatedly replay already-staged mailbox items, and risk blocking unrelated fresh
input behind old pending input.

The smallest safe architecture is not a rich queue. It is a hosted pending input
ID index:

- Authoritative input truth remains `AssistantInputEvent`.
- Authoritative handled truth remains auto-reply terminal evidence.
- Derived hosted operational state is only an ordered set of `inputIds`.

Do not store cursor, source, conversation key, queued timestamp, text,
attachments, delivery target, or prompt data in the pending index. Those already
live on the input event.

## Current complexity to remove

The hot path currently passes fresh hosted IDs through three concepts that all
represent "prefer this known input":

- `preferredInputIds`
- `foregroundReplayInputIds`
- `foregroundReplayPromptInputIds`

Concrete seams:

- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
  - `resolveHostedForegroundReplayInputIds`
  - `resolveHostedForegroundReplayPromptInputIds`
  - `preferredInputIds`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
  - `runHostedAssistantAutomationLane`
  - `runHostedAssistantAutomation`
  - `foregroundReplayScanLimit`
  - replay/preferred redacted log fields
- `packages/assistant-runtime/src/hosted-runtime/turn-input.ts`
  - `createHostedAssistantInputSource`
  - `mergePreferredAssistantInputCandidates`
  - `buildForegroundReplayCandidateBatch`
  - `maskForegroundReplayCandidatePromptContent`

Maintenance risk: `createHostedAssistantInputSource` always starts from
`createStoreBackedAssistantInputSource`, and both preferred/replay wrappers call
`listInputCandidates` before direct-reading known IDs. That routes fresh hosted
foreground input through `listAssistantInputEvents`, whose current implementation
reads and parses every input-event JSON file before filtering and sorting.

Smallest safe follow-up: replace hosted foreground preferred/replay plumbing with
one direct, pending-index-backed input source and delete the preferred/replay
layer instead of optimizing it.

## Target architecture

### 1. Add a hosted pending input ID index

Add a small hosted-runtime state file, colocated with hosted mailbox state:

- `packages/assistant-runtime/src/hosted-runtime/pending-input-index.ts`
- Runtime path: `.runtime/operations/assistant/hosted-pending-inputs.json`

Versioned value shape:

```ts
{
  inputIds: string[];
}
```

Use the same versioned state helpers already used by
`packages/assistant-runtime/src/hosted-runtime/mailbox-state.ts`.

Required operations:

- `enqueueHostedPendingAssistantInputId({ vaultRoot, inputId })`
- `readHostedPendingAssistantInputIds({ vaultRoot })`
- `compactHostedPendingAssistantInputIds({ vaultRoot })`
- `hasHostedPendingAssistantInput({ vaultRoot })`

No migration, no backfill, no repair-on-read in the foreground path.

Missing file means an empty index for greenfield state. Malformed file must fail
closed, not silently return empty. A malformed pending index should prevent
consume ack and surface as a runtime failure rather than dropping staged input.

Risk if done poorly: treating a corrupt index as empty can silently skip old
staged inputs that are no longer in the fresh import result.

### 2. Enqueue at the staging seam before mailbox watermark advancement

Modify `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`.

Concrete seam:

- `stageHostedConversationAssistantInputEvent`
- `upsertAssistantInputEvent`
- `updateAssistantInputProjection`
- `importHostedConversationMailboxItem`
- `fetchAndProcessHostedMailboxPrefix`

Current code writes the event and marks the projection pending in
`stageHostedConversationAssistantInputEvent`. Enqueue the returned `event.inputId`
immediately after the event exists and the pending projection update has been
attempted.

If enqueue fails, throw from staging. That prevents
`importHostedConversationMailboxItem` from returning `status: "imported"`, which
prevents `fetchAndProcessHostedMailboxPrefix` from advancing the conversation
lane watermark for that item.

Smallest safe follow-up: add enqueue to the default stager only; keep
test-injected stagers explicit.

Risk if done poorly: enqueueing after the import loop advances its watermark
creates exactly the silent-drop state this refactor is meant to remove.

### 3. Extract the terminal-evidence predicate once

Modify:

- `packages/assistant-engine/src/assistant/automation/evidence.ts`
- `packages/assistant-engine/src/assistant/automation/scanner.ts`
- `packages/assistant-engine/src/assistant/automation.ts`

Current terminal completeness logic is private inside
`scanner.ts:listAssistantReplyCandidates`. It checks input-id evidence,
capture-id fallback evidence, and complete group evidence before skipping a
candidate.

Extract and export one helper:

```ts
hasCompleteAssistantAutoReplyTerminalEvidence(input: {
  vault: string;
  inputId: string;
  captureId?: string | null;
}): Promise<boolean>
```

Use that helper from both:

- `scanner.ts:listAssistantReplyCandidates`
- hosted pending input index compaction

Smallest safe follow-up: move only the existing predicate logic; do not redesign
terminal evidence.

Risk if done poorly: duplicating terminal logic will eventually create drift
where the scanner considers an input handled but the pending index keeps it
forever, or the pending index drops it before the scanner would.

### 4. Replace hosted input source with a direct selected-ID source

Modify `packages/assistant-runtime/src/hosted-runtime/turn-input.ts`.

Replace `createHostedAssistantInputSource` with a hosted direct source that
receives selected IDs, direct-reads those events, and implements both required
APIs:

- `listInputCandidates`
- `listNewConversationInputs`

The direct source must apply the same query-level filters currently expected by
assistant automation:

- `afterCursor`
- `knownInputIds`
- `knownProjectionCaptureIds`
- `sourceId`
- `conversation`
- `limit`

It must not call `createStoreBackedAssistantInputSource` or
`listAssistantInputEvents`.

Selection rules:

- Fresh foreground pass starts with
  `initialMailboxImport.importResult.assistantInputIds`.
- Read compacted pending IDs.
- Direct-read pending and fresh events by ID.
- For each fresh conversation, include every non-terminal pending event in the
  same conversation with cursor less than or equal to the latest fresh event in
  that conversation.
- Include fresh events even if the index read is stale.
- Do not include unrelated old pending conversations in the foreground
  provider-start source.
- Sort selected candidates by `compareAssistantInputCursors`.

Use the existing conversation comparator from
`packages/assistant-engine/src/assistant/conversation-ref.ts` by exporting it
through the public assistant-engine surface instead of reimplementing
conversation equality in hosted runtime.

Smallest safe follow-up: build the direct source in `turn-input.ts`; avoid a
generic indexing subsystem.

Risk if done poorly: missing `listNewConversationInputs` or route/source
filtering will break active-turn same-conversation admission in
`packages/assistant-engine/src/assistant/automation/reply.ts:listAutoReplyActiveTurnInputs`.

### 5. Replace hosted automation lane parameters

Modify:

- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`

Delete hosted foreground parameters:

- `preferredInputIds`
- `foregroundReplayInputIds`
- `foregroundReplayPromptInputIds`

Replace them with:

```ts
freshAssistantInputIds?: readonly string[] | null
```

`runHostedAssistantAutomation` should build the hosted input source from:

- `freshAssistantInputIds`
- compacted pending index
- `vaultRoot`

Delete `foregroundReplayScanLimit` and the special `maxPerScan` override. The
pending index now bounds the hosted foreground source directly; scan limit should
no longer be used as a replay safety mechanism.

Smallest safe follow-up: keep the existing timing and query-count logs, but
remove replay/preferred count fields.

Risk if done poorly: preserving replay/preferred parameters alongside the
pending index leaves two correctness mechanisms active and makes future input
ordering bugs harder to reason about.

### 6. Make pending wake and mailbox consume ack index-backed

Modify:

- `packages/assistant-runtime/src/hosted-runtime/pending-assistant-input.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`

Current `resolveHostedPendingAssistantInputWakeAt` reads automation state,
creates a hosted input source, and calls `hasPendingAssistantAutoReplyInput`,
which reaches scanner-backed `listInputCandidates`.

Replace it with:

- compact pending index
- return immediate wake if any non-terminal pending ID remains
- return null if compacted index is empty

`acknowledgeHostedConversationMailboxConsumedBestEffort` should continue to skip
consume ack when pending input exists, but the check must use the pending index
rather than scanner-backed candidate discovery.

Smallest safe follow-up: keep the existing consume-ack gate and logging; swap
only the pending-input predicate.

Risk if done poorly: advancing `consumed_seq` while the pending index still has
non-terminal input can make an unhandled staged message unrecoverable after a
crash.

### 7. Background catch-up uses the same index

When there is no fresh foreground input, hosted assistant automation should
select a bounded oldest set of non-terminal pending IDs from the index and
process those.

Unrelated old pending input must not block fresh foreground input, but it must
remain in the index and schedule immediate assistant work after the foreground
pass.

Smallest safe follow-up: use one selection helper with two modes:

```ts
selectHostedAssistantInputIds({
  mode: "foreground",
  freshAssistantInputIds,
  vaultRoot,
})

selectHostedAssistantInputIds({
  mode: "background",
  limit,
  vaultRoot,
})
```

Risk if done poorly: foreground-only handling fixes latency but leaves old staged
input stranded forever.

## What to delete in the first pass

Delete from `packages/assistant-runtime/src/hosted-runtime/turn-input.ts`:

- preferred wrapper around `listInputCandidates`
- foreground replay wrapper around `listInputCandidates`
- `mergePreferredAssistantInputCandidates`
- `buildForegroundReplayCandidateBatch`
- `maskForegroundReplayCandidatePromptContent`
- `uniqueAssistantInputCandidates` if no longer used
- `normalizePreferredAssistantInputLimit` if no longer used

Delete from `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`:

- `HOSTED_FOREGROUND_REPLAY_PROMPT_INPUT_LIMIT`
- `resolveHostedForegroundReplayInputIds`
- `resolveHostedForegroundReplayPromptInputIds`
- `preferredInputIds` plumbing

Delete from `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`:

- `foregroundReplayInputIds`
- `foregroundReplayPromptInputIds`
- `preferredInputIds`
- `foregroundReplayScanLimit`
- `normalizeHostedForegroundReplayScanLimit`
- replay/preferred redacted log fields
- replay-specific `maxPerScan` override

Delete or rewrite tests that encode old mechanics:

- `packages/assistant-runtime/test/hosted-runtime-turn-input.test.ts`
  - preferred-order test
  - foreground replay prompt masking test
  - replay boundary test
  - replay slot reservation test
- hosted phase/maintenance tests that assert preferred/replay IDs are passed
  through

## Do not delete

- `AssistantInputEvent` store
- `readAssistantInputEvent`
- `upsertAssistantInputEvent`
- `updateAssistantInputProjection`
- terminal auto-reply evidence
- `listAssistantInputEvents` for non-hosted scanner paths and explicit
  repair/admin tooling
- automation `eligibleAfter` for generic scanner state

## What not to add

Do not add:

- a database
- a cache service
- a Temporal/Cloudflare pending-input authority
- a web-owned mailbox state
- a general indexing subsystem
- queue entries with cursor/source/conversation metadata
- auto-repair/backfill on the foreground path
- config knobs for queue limits or replay behavior

If the single ID index becomes large in measured traces, address that with
evidence in a later pass. Do not shard or add secondary indexes now.

## Implementation sequence

1. Extract `hasCompleteAssistantAutoReplyTerminalEvidence` from scanner terminal
   logic into `automation/evidence.ts` and update scanner to call it.
2. Add `hosted-runtime/pending-input-index.ts` with versioned read/write,
   idempotent enqueue, terminal-aware compaction, and strict malformed-state
   handling.
3. Enqueue hosted assistant input IDs in
   `stageHostedConversationAssistantInputEvent` before imported outcomes can
   advance mailbox watermarks.
4. Replace `createHostedAssistantInputSource` with a direct selected-ID source
   that implements both assistant input APIs without calling the store-backed
   scanner.
5. Replace foreground replay/preferred plumbing in
   `workspace-assistant-phase.ts` and `maintenance.ts` with
   `freshAssistantInputIds`.
6. Replace `resolveHostedPendingAssistantInputWakeAt` and mailbox consume-ack
   pending checks with compacted index reads.
7. Rewrite tests around the new invariant and delete tests that only preserve
   old replay/preferred mechanics.

## Verification

Required unit tests:

- pending index missing file returns empty
- malformed pending index fails closed
- enqueue is idempotent by `inputId`
- enqueue preserves one logical pending set with no duplicate IDs
- terminal evidence compaction removes an input only when terminal group
  evidence is complete
- staging a hosted conversation input enqueues before import success is reported
- enqueue failure prevents `fetchAndProcessHostedMailboxPrefix` from advancing
  the conversation lane watermark
- foreground same-conversation A pending plus B fresh selects A and B
- foreground unrelated A pending plus B fresh selects only B and leaves A pending
- background mode selects oldest non-terminal pending IDs
- direct source `listInputCandidates` applies source, cursor, known ID, and
  limit filters
- direct source `listNewConversationInputs` applies conversation, cursor, known
  input, known projection capture, and limit filters
- foreground/direct source test fails if `listAssistantInputEvents` is called
- pending wake returns immediate wake when compacted index has any non-terminal
  ID
- pending wake returns null when index is empty after compaction
- mailbox consume ack skips on pending index entries and advances only when the
  compacted index is empty

Required integration checks:

- warm hosted Linq/iMessage fresh input reaches provider-start without a broad
  `listAssistantInputEvents` scan
- same-conversation staged inputs are included in one foreground assistant pass
- unrelated old pending input does not delay fresh foreground provider start
- old unrelated pending input is processed by the next background/catch-up pass
- typecheck and targeted hosted-runtime plus assistant-automation tests pass

## Main risks

- Enqueue after mailbox watermark advancement can silently drop staged input.
- Returning empty on malformed pending state can silently drop old staged input.
- Duplicating terminal evidence semantics can create stuck or prematurely
  removed pending IDs.
- Storing cursor/source/conversation metadata in the index can drift from
  `AssistantInputEvent`.
- Keeping preferred/replay plumbing active after adding the index preserves the
  current concept count and makes ordering bugs harder to isolate.
- Implementing only `listInputCandidates` and not `listNewConversationInputs`
  breaks active-turn same-conversation admission.
