# 2026-04-17 Hosted Inbound Target Architecture Review Notes

## Scope

This is a point-in-time review of the proposed hosted inbound target architecture patch against the current codebase.

It is not a canonical architecture spec.

## Verdict

Directionally, the proposal is strong.

If the active-member hosted inbound path were being redesigned from scratch, the proposed model is cleaner than the current path:

- `apps/web` stays the public ingress and hosted control plane
- inbound active-member messages become `append normalized input -> wake user`
- Cloudflare becomes a narrow per-user execution coordinator
- session continuity relies on the same conversation-binding model local already uses

The proposal is not ready to apply verbatim, though. The right next step is a narrow migration for active-member Linq and Telegram inbound traffic only, with a few invariants tightened before any cutover.

## What The Proposal Gets Right

### 1. `apps/web` should stay the public ingress and control plane

The current webhook entrypoints already do real hosted control-plane work.

- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts`

Those paths do more than transport parsing. They already own:

- provider-authenticated webhook entry
- member lookup and active/suspended gating
- onboarding and quota policy
- hosted routing decisions

Moving that boundary into `apps/cloudflare` would create a second hosted control plane rather than simplifying the system.

### 2. The current active-member inbound path has too many lifecycle owners

Today, an active-member inbound message touches several stateful stages:

1. `apps/web` webhook receipt machinery
2. `apps/web` execution outbox rows
3. `apps/cloudflare` staged dispatch / queue / run state
4. `apps/cloudflare` execution journal and side-effect journal
5. `packages/assistant-runtime` event-specific ingest + maintenance + snapshot + committed outbox drain

Representative files:

- `apps/web/src/lib/hosted-onboarding/webhook-receipt-engine.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-store.ts`
- `apps/web/src/lib/hosted-execution/outbox.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-dispatch-processor.ts`
- `apps/cloudflare/src/user-runner/runner-queue-store.ts`
- `apps/cloudflare/src/execution-journal.ts`
- `apps/cloudflare/src/side-effect-journal.ts`
- `packages/assistant-runtime/src/hosted-runtime/execution.ts`

That is too much ownership for the hot path of “user sent a message, continue the conversation.”

### 3. One per-user ordered input stream is a better mental model than one hosted dispatch per inbound message

The current runtime is still organized around event-specific hosted dispatches.

`packages/assistant-runtime/src/hosted-runtime/events.ts` routes each dispatch kind into a separate ingestion path, and `packages/assistant-runtime/src/hosted-runtime/execution.ts` then runs the full maintenance loop after dispatch handling.

For active-member chat traffic, that is heavier than necessary.

The proposed model of:

- append ordered input
- hold one per-user lease
- drain unseen inputs

better matches the local-first mental model and better explains rapid-turn correctness.

### 4. Reusing ordinary session-binding semantics is the right direction

The current assistant session lookup already has concrete binding semantics.

- `packages/assistant-engine/src/assistant/store.ts`
- `packages/assistant-engine/src/assistant/store/paths.ts`
- `packages/assistant-engine/src/assistant/bindings.ts`

In particular, `resolveAssistantConversationKey(...)` already derives the conversation lookup key from:

- `channel`
- `identityId`
- thread scope when present
- actor scope when thread scope is absent and actor scope is valid

That is the right foundation. Hosted should not grow a second session owner.

## Current Architecture Reality Check

The proposal is reacting to something real.

For active-member Linq and Telegram inbound traffic, today’s shape is effectively:

1. `apps/web` authenticates and interprets the provider webhook.
2. It writes webhook receipt state and/or execution-outbox state.
3. It dispatches a hosted execution event to Cloudflare.
4. Cloudflare queues that event in the per-user runner.
5. The runner restores a snapshot and invokes the hosted runtime.
6. The hosted runtime rehydrates the inbox pipeline and converts the hosted event back into a capture-like ingress operation.
7. It then runs hosted maintenance, which may do parser, device-sync, and assistant automation work.
8. It snapshots again, records committed delivery effects, and drains those effects after commit.

Files that show this directly:

- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts`
- `apps/web/src/lib/hosted-execution/outbox.ts`
- `apps/cloudflare/src/user-runner/runner-dispatch-processor.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/linq.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/telegram.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/inbox-pipeline.ts`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`

That stack works, but it is more general than the active-member message path really needs.

## Pushback And Clarifications

### 1. The proposal needs a stronger append-and-ack contract

`append normalized input -> wake user` is the right shape, but the real contract is:

- authenticate
- dedupe
- allocate per-user sequence
- append durable input record
- acknowledge successfully even if the wake call is retried later

If `wake(userId)` fails after append, the system still needs a repair path.

That means the canonical source of truth cannot be only `targetSeq` in the coordinator. The coordinator may cache `targetSeq`, but correctness must still be recoverable from the input log itself.

Recommended invariant:

- canonical ingress owner stores `maxCommittedInputSeq` or equivalent derivable high-water state
- coordinator wake is advisory, not the only durable signal

### 2. `ConversationInput` must not be an underspecified thin envelope

The proposal is right to say the executor should not need raw provider webhook bodies just to rebuild a hosted capture.

But a too-thin `ConversationInput` type would just create a new lossy seam and force later re-expansion.

Current hosted ingress eventually flows into:

- Linq capture normalization via `normalizeLinqWebhookEvent(...)`
- Telegram capture normalization via `normalizeHostedTelegramMessage(...)`

Files:

- `packages/assistant-runtime/src/hosted-runtime/events/linq.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/telegram.ts`

Recommended change:

- define `ConversationInput` from the current capture/session-routing needs, not from a minimal transport wish
- keep enough fields for stable dedupe, session lookup, reply threading, and attachment follow-up
- do not design it so narrowly that later inbox, parser, or gateway layers need a second reconstruction step

### 3. `conversationKey` should reuse existing binding semantics, not invent a near-match

The patch suggests a deterministic `conversationKey` built from `channel`, `identityId`, `participantId`, `threadId`, and directness.

That is directionally right, but the repo already has a concrete implementation shape in:

- `packages/assistant-engine/src/assistant/bindings.ts`
- `packages/assistant-engine/src/assistant/store/paths.ts`

Today’s session lookup is not a plain concatenation of all possible fields. It prefers:

- thread scope when a thread exists
- actor scope when there is no thread scope and actor scope is allowed
- a fallback lookup variant with `threadId` removed

Recommended change:

- do not introduce a hosted-only `conversationKey` formula
- extract or reuse the existing assistant binding key builder as the shared contract
- if the current owner package is wrong for web ingress use, move the shared key builder down into a lower shared owner rather than duplicating it

### 4. The proposal is too eager to treat the local proxy bridge as architectural waste

The patch recommends deleting callback proxies and local tunnel complexity from the inbound hot path.

That is the right production direction.

But the recent hosted-local Linq/Telegram continuity fix exposed a separate issue: local hosted execution spans a host-side worker/dev harness and an isolated runner container. In that environment, plain `127.0.0.1` assumptions are wrong, and a narrow bridge exists because the container and host are not the same network surface.

Relevant files:

- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/src/local-loopback-proxy.ts`

Recommended clarification:

- remove callback/proxy dependence from the production active-member inbound hot path
- do not assume the hosted-local harness can immediately delete every bridge seam unless all executor dependencies are prefetched or replaced by a single explicit adapter

In other words: the bridge is a smell in the hot path, but it is also partly a property of the hosted-local test topology.

### 5. Deleting journals and delivery recovery should happen later than the patch suggests

The proposal is correct that some current layers are recovery evidence, not product truth.

The code even says so explicitly:

- `apps/cloudflare/src/execution-journal.ts`
- `apps/cloudflare/src/side-effect-journal.ts`

But those layers still currently carry real crash-recovery value for the present runtime model.

Recommended change:

- first move active-member inbound ordering to input-log + coordinator
- then prove snapshot-owned assistant outbox and receipts fully cover the post-commit delivery guarantees needed for that path
- only then remove message-path dependence on execution/side-effect journals

Deleting them before the new outbox/receipt boundary is proven would risk replacing complexity with hidden fragility.

### 6. Not every wake reason should be pulled into the same first-cut drain path

The proposal says there are only two work shapes:

- input appended
- system wake reason

That is a good end-state abstraction.

But today the runtime still does a lot of shared maintenance per pass:

- parser drain
- device sync reconciliation
- assistant automation

File:

- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`

Recommended migration stance:

- active-member Linq and Telegram inbound messages should be first-cut users of the new input-log path
- `member.activated`, `member.channels.updated`, `vault.share.accepted`, cron-like wakes, parser follow-up, and device sync should remain explicit wake classes initially
- only consolidate broader wake lanes after the active-member message path proves stable

## Recommended Target Shape

The patch’s end state is mostly right, with a few sharper boundaries.

### A. Web-owned canonical ingress state

`apps/web` should own:

- provider-authenticated inbound webhook processing
- per-user append-only conversation input log
- ingress dedupe keyed by provider-native immutable ids
- hosted control-plane truths such as identity, routing, billing, onboarding

### B. Cloudflare-owned narrow execution coordination

`apps/cloudflare` should own only:

- lease / in-flight run state
- `lastCommittedSeq`
- `targetSeq` as a cache or wake hint
- `snapshotRef`
- `nextWakeAt`

### C. Snapshot-owned execution residue

The snapshot should remain the owner of runtime residue such as:

- assistant sessions and bindings
- outbox intents
- receipts and related execution residue

This is already closer to the current local mental model than the generic hosted dispatch/event layering.

## Smallest Viable Migration Slice

### Phase 1: Shared routing contract

Extract or standardize one shared conversation-binding key builder derived from the existing assistant binding/session logic.

Do not create a hosted-only formula.

### Phase 2: Web-side canonical input log

Add a hosted per-user input log in `apps/web` for active-member Linq and Telegram inbound messages only.

Each row should include at least:

- user id
- monotonic per-user sequence
- ingress dedupe identity
- conversation binding fields
- normalized message payload sufficient for downstream capture/session routing
- attachment references or normalized attachment metadata as needed

### Phase 3: Dual-write and shadow wake

For active-member Linq and Telegram inbound messages:

- keep the current hosted dispatch path alive
- also append to the new input log
- wake the new coordinator in shadow mode

Use this to prove ordering and session reuse without risking production delivery.

### Phase 4: New executor entrypoint

Add a new hosted executor entrypoint that takes:

- committed snapshot ref
- unseen conversation inputs
- explicit system wake reason when applicable

This entrypoint should drain unseen active-member message inputs without forcing the full current event adapter stack for every single message.

### Phase 5: Cut over active-member Linq and Telegram only

Once shadow comparison is stable, cut active-member Linq and Telegram inbound traffic over to:

- append normalized input
- wake user coordinator

Keep onboarding, billing, share acceptance, parser follow-up, and device-sync wakes on their current explicit paths.

### Phase 6: Simplify post-commit delivery

After the new coordinator path is stable, simplify the post-commit delivery model around snapshot-owned outbox and receipts.

Only then remove the now-redundant message-path journal and staging layers.

## Practical Recommendations

If this proposal moves forward, the safest near-term changes are:

1. Reuse existing session-binding semantics rather than inventing a new hosted `conversationKey`.
2. Add a web-owned per-user canonical input log for active-member Linq and Telegram only.
3. Treat `wake(userId)` as advisory; correctness must survive wake loss.
4. Keep the current explicit control-plane event paths for non-message wakes until the new message path is proven.
5. Remove callback/proxy dependence from the production inbound hot path, but do not conflate that with immediately deleting every hosted-local bridge seam.

## Bottom Line

The proposal is better than the current architecture as a long-term target.

Its strongest idea is not “move work to Cloudflare.” Its strongest idea is “reduce the number of lifecycle owners for active-member inbound messages.” That is the right diagnosis.

The biggest missing pieces are:

- a precise append-and-ack contract
- a non-lossy `ConversationInput` contract
- reuse of the existing session-binding key semantics
- a narrower migration plan that targets active-member Linq and Telegram first

If those pieces are tightened, this is a credible target architecture.
