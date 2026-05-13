I checked this against the current Murph shape pretty carefully. My strongest conclusion is:

> **Do not add another abstraction. Delete the bespoke auto-reply receipt-recovery engine. Keep Codex as the recovery authority for provider/thread state, and keep Murph only as the input/delivery/audit boundary.**

The current code is already closer to that than the earlier plan assumed: Murph now has `AssistantConversation v2`, centralized `codexResume`, route fingerprinting, and failure recovery that no longer persists recovered Codex thread IDs. The main remaining architectural smell is `startup-recovery.ts`.

## The key finding

`startup-recovery.ts` is still a second reply engine.

It scans failed receipts, reconstructs auto-reply groups from receipt metadata, loads input events, validates grouping, and then calls `processAssistantAutoReplyGroup` directly. That means a failed receipt can create a new Codex/provider turn without going through the normal scanner path. 

That is exactly the class of issue you are trying to eliminate.

Also: in the commit I checked, I did **not** find the cursor fence Murph described. `startup-recovery.ts` reads `autoReply` and builds `autoReplyByChannel`, but I did not find a comparison against `channelState.eligibleAfter` before calling `processAssistantAutoReplyGroup`. 

So either the patch is not in the checked commit, or it exists elsewhere. But architecturally, I would not keep that path anyway.

## What is already clean and should stay

The normal scanner is the right owner of auto-reply production. It lists input candidates after the per-channel `eligibleAfter` cursor, filters completed terminal evidence, groups adjacent inputs, calls `processAssistantAutoReplyGroup`, and advances the cursor only when the returned result says to advance. 

The reply path already has the right local repair behavior. Inside `evaluateAssistantAutoReplyGroup`, it checks existing terminal evidence, repairs/backfills evidence when possible, and can use handled receipts to avoid duplicate work. That is very different from startup recovery because it happens inside the scanner path and only prevents duplicate work; it does not independently search for failed receipts and create work. 

The outbox is also already the right delivery recovery mechanism. It dedupes outbox intents, has delivery idempotency keys, repairs receipts for intents, handles stale sending states, retries due delivery intents, and fail-closes ambiguous non-idempotent delivery cases. 

Codex continuity is also already much cleaner: Murph has a small `CodexResumeState` with `threadId`, `routeFingerprint`, and optional `rolloutRelativePath`; legacy `providerSessionId` / `resumeRouteId` are normalized into that shape. 

The route guard is important and should stay: Murph only resumes a Codex thread if the stored route fingerprint exactly matches the current route fingerprint. 

Provider failure recovery is also already in the right direction: it extracts a recovered provider session id only to attach `recoveredCodexThreadId` to error context, and returns `null` instead of persisting a recovered session. 

## The final minimal architecture

I would make the system this:

```txt
Murph input source
  -> normal auto-reply scanner
    -> grouping / eligibility
      -> sendAssistantMessage
        -> Codex thread/start or thread/resume
        -> Codex turn/start
        -> Murph outbox delivery
        -> Murph terminal evidence
        -> advance auto-reply cursor
```

On restart:

```txt
drain Murph outbox
refresh input source
run normal scanner
```

That’s it.

No startup receipt recovery.

No failed-receipt candidate selection.

No recovery-specific group reconstruction.

No recovery-specific eligibility helper.

No new table.

No new durable auto-reply state machine.

No Murph-side Codex turn recovery.

## What Codex owns

Codex should own:

```txt
thread history
thread resume
turn lifecycle
in-progress/active status
rollback
compaction
rollout reconstruction
provider-side continuity
```

Codex App Server explicitly exposes threads, turns, items, `thread/start`, `thread/resume`, `turn/start`, `turn/steer`, `turn/interrupt`, and `turn/completed` notifications. 

Codex also records canonical rollout JSONL and can load rollout history into resumed history. 

Murph should not duplicate that with receipt-driven provider-turn recovery.

## What Murph owns

Murph should own only:

```txt
external input ingestion
input cursor / eligibility
grouping
delivery route selection
outbox delivery
delivery receipts
audit evidence
Codex thread pointer
route fingerprint safety
hosted checkpoint inclusion of Codex rollout state
```

That is already mostly how the current code is shaped.

## The exact deletion I would do

### 1. Remove receipt recovery from `runAssistantAutomationPass`

Delete this conceptual block from `run-loop.ts`:

```ts
const runReceiptRecovery = () => recoverAssistantAutoReplies(...)
...
let recovery = await runReceiptRecovery()
...
if (deferReceiptRecovery) { ... }
```

Then the pass is simpler:

```ts
await drainAssistantOutbox(...)
await inputSource.refresh(...)
const state = await readAssistantAutomationState(...)
const scanResult = await scanAssistantAutomationOnce(...)
if (queueOnly && scanResult.replies.replied > 0) {
  await drainAssistantOutbox(...)
}
```

The current run loop wires `recoverAssistantAutoReplies` before the scan unless recovery is explicitly deferred.  That should go.

### 2. Delete `startup-recovery.ts`

Or, as a first PR, make it impossible for it to create work:

```txt
startup-recovery.ts must not import processAssistantAutoReplyGroup
```

That single import is the smell.

If a recovery helper remains temporarily, it should only backfill evidence from non-failed handled receipts. But I would prefer deleting it outright and keeping evidence repair inside scanner evaluation.

### 3. Keep scanner-local receipt fallback

Do not delete the scanner’s handled-receipt fallback yet.

Reason: it is not a second producer. It is a duplicate-prevention repair path. If Codex completed and a receipt exists but terminal evidence is missing, the scanner can backfill evidence and skip the group instead of starting another Codex turn. 

Keep this rule:

```txt
Receipts may prove already handled.
Receipts may not create new work.
```

### 4. Keep outbox recovery

Outbox recovery is not duplicated by Codex. Codex produced a response; Murph owns external delivery.

So keep:

```txt
outbox intent dedupe
delivery idempotency key
delivery retry
stale sending reconciliation
delivery receipt repair
```

The outbox already does this. 

## Edge cases checked

### Container dies before scanner processes input

State:

```txt
cursor not advanced
no terminal evidence
```

Behavior after deletion:

```txt
normal scanner sees input and processes it
```

Good.

### Container dies after provider failure, before cursor advance

State:

```txt
cursor not advanced
failed receipt may exist
no terminal evidence
```

Behavior after deletion:

```txt
normal scanner may retry because input is still ahead of cursor
```

Good. This is scanner-owned retry, not receipt-owned recovery.

### Container dies after delivery queued

State:

```txt
outbox intent exists
reply intent / terminal evidence should exist or scanner-local receipt fallback can repair
```

Behavior:

```txt
outbox drain retries delivery
scanner should not regenerate provider work
```

Good. The outbox is the right recovery surface.

### Container dies after cursor advances

State:

```txt
input is consumed
```

Behavior after deletion:

```txt
do not retry from failed receipts
```

This is the intended fail-closed behavior. It may miss an auto-reply in a rare ambiguous case, but it avoids duplicate replies and eliminates the bug class.

### Stale failed receipt behind cursor

Current dangerous behavior:

```txt
startup recovery can discover it and call processAssistantAutoReplyGroup
```

Final behavior:

```txt
ignored forever
```

Correct.

### Stale failed receipt ahead of cursor

Final behavior:

```txt
normal scanner owns retry
```

Correct.

### Completed/deferred receipt but missing terminal evidence

Final behavior:

```txt
normal scanner can backfill terminal evidence from handled receipt and skip
```

Correct. This is why I would keep scanner-local receipt fallback for now.

### Failed delivery

Final behavior:

```txt
outbox retry or fail closed
never regenerate Codex turn
```

Correct.

### Route/target changed

Current code already clears/prevents stale resume through route fingerprint matching. Keep it. 

### Provider failure with recovered Codex thread id

Current code already avoids persisting the recovered id on failure. Keep it. 

### Fresh Codex fallback after stale resume

Current Codex adapter can fresh-start when resume is stale/invalid, and finalization persists the new `codexResume` only on successful provider result. That is fine.  

## One tradeoff to be explicit about

Deleting startup receipt recovery changes this policy:

```txt
failed receipt behind cursor -> no retry
```

That is the right policy for minimal complexity.

If the product requires “never miss an auto-reply,” then you need durable pre-submit state keyed by input group. But that means a new state machine/table/intent layer. Given your priority, I would not do that.

The clean product rule should be:

```txt
Duplicate auto-replies are worse than missed replies in ambiguous crash windows.
```

If that is true, the architecture is simple.

## The only tiny thing I would consider keeping

If rate-limit retry spacing matters after restart, scanner evaluation could optionally read failed receipt `autoReplyRetryAt` and defer the input until that time.

But I would treat that as optional. The absolute minimal version does not need it. If you keep it, it must live inside scanner evaluation and obey this rule:

```txt
retryAt can delay scanner work
retryAt cannot create work
```

## Final absolute minimal shape

```txt
1. Murph has one auto-reply producer: scanAssistantAutomationOnce.
2. Codex has one provider continuity owner: thread/resume + rollout history.
3. Murph has one delivery recovery owner: outbox drain.
4. Receipts are audit/evidence only.
5. Terminal evidence prevents duplicates.
6. Cursor consumes inputs.
7. Failed receipts never start Codex turns.
```

In code:

```txt
delete:
  recoverAssistantAutoReplies
  startup-recovery.ts
  listReceiptRecoveryCandidates
  loadAutoReplyRecoveryContext
  hasUnsafeDeliveryEvidence
  hasTerminalProviderValidationFailure
  deferReceiptRecovery
  runReceiptRecovery

keep:
  scanAssistantAutomationOnce
  processAssistantAutoReplyGroup
  scanner-local handled-receipt fallback
  auto-reply terminal evidence
  outbox
  codexResume
  routeFingerprint
```

## The invariant I would write into tests

```txt
Only scanAssistantAutomationOnce may cause processAssistantAutoReplyGroup to run for auto-reply input.
```

And:

```txt
A failed assistant turn receipt must never cause a new auto-reply provider turn.
```

That is the final shape I’d recommend. It deletes the bespoke recovery architecture instead of trying to perfect it.
