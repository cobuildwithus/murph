# Murph composability review — 2026-03-31

This review is grounded in the current code in:

- `packages/cli`
- `packages/core`
- `packages/query`
- `packages/inboxd`
- `packages/device-syncd`
- `apps/web`

It focuses on files that are large **and** visibly carrying multiple seams today. The recommendations below prioritize responsibility boundaries over raw line count.

## Changes included in this patch

This patch adds this review document only. It does **not** preemptively move code.

That is intentional: the risky part in these files is not that they are long, but that several ownership seams are already packed together. Each `split now` item below includes a follow-up extraction path that can land safely without widening package or trust boundaries.

## split now

### 1. `packages/cli/src/assistant/ui/ink.ts`

**Main seam:** terminal shell vs. composer/editor state machine vs. transcript rendering vs. assistant turn controller.

**Concrete file / symbols**

- terminal shell and input adaptation:
  - `resolveChromePanelBoxProps`
  - `supportsAssistantInkRawMode`
  - `resolveAssistantInkInputAdapter`
  - `runAssistantChatWithInk`
- transcript and message rendering:
  - `resolveMessageRoleLabel`
  - `renderWrappedTextBlock`
  - `wrapAssistantPlainText`
  - `renderWrappedPlainTextBlock`
  - `splitAssistantMarkdownLinks`
  - `resolveAssistantHyperlinkTarget`
  - `formatAssistantTerminalHyperlink`
  - `supportsAssistantTerminalHyperlinks`
  - `renderAssistantMessageText`
  - `renderChatTranscriptFeed`
  - `partitionChatTranscriptEntries`
  - `ChatHeader`
  - `ChatEntryRow`
  - `ChatStatus`
  - `ChatFooter`
  - `ModelSwitcher`
- composer/editor state machine:
  - `normalizeAssistantInkArrowKey`
  - `mergeComposerDraftWithQueuedPrompts`
  - `resolveComposerTerminalAction`
  - `ComposerInput`
  - `reconcileComposerControlledValue`
  - `resolveComposerVerticalCursorMove`
  - `applyComposerEditingInput`
  - `normalizeComposerInsertedText`
  - `renderComposerValue`
- turn orchestration and queueing:
  - `reduceAssistantPromptQueueState`
  - `reduceAssistantTurnState`
  - `resolveAssistantQueuedPromptDisposition`
  - `resolveAssistantSelectionAfterSessionSync`
  - `runAssistantPromptTurn`
  - `useAssistantChatController`

**Why the current shape hurts composability**

This file is not just "the Ink chat UI." It currently owns four different units of behavior:

1. terminal capability detection and raw input normalization
2. pure text/transcript rendering
3. the multiline composer editing engine
4. the provider-backed chat turn controller and queue reducer

Those seams change for different reasons and should be testable in different ways. A bug in `applyComposerEditingInput` or cursor movement should not require a reader to carry provider event handling, model discovery, queued prompt replay, and transcript rendering in their head at the same time. Likewise, a change in `runAssistantPromptTurn` or session-selection sync should not live in the same module as markdown link parsing and terminal hyperlink formatting.

The file is large because several real ownership boundaries are stacked together, not because one boundary is inherently huge.

**Smaller target module boundaries**

Keep `packages/cli/src/assistant/ui/ink.ts` as the composition root that launches Ink and wires together the submodules.

Extract:

- `packages/cli/src/assistant/ui/ink/composer.tsx`
  - `ComposerInput`
  - the editing-state types
  - `normalizeAssistantInkArrowKey`
  - `resolveComposerTerminalAction`
  - `reconcileComposerControlledValue`
  - `resolveComposerVerticalCursorMove`
  - `applyComposerEditingInput`
  - `normalizeComposerInsertedText`
  - `renderComposerValue`
- `packages/cli/src/assistant/ui/ink/transcript.tsx`
  - message-role labels
  - wrapped-text helpers
  - markdown-link / terminal-hyperlink helpers
  - `renderAssistantMessageText`
  - `renderChatTranscriptFeed`
  - `partitionChatTranscriptEntries`
  - transcript/footer/status/header components
- `packages/cli/src/assistant/ui/ink/controller.ts`
  - prompt queue reducer
  - turn reducer
  - queued prompt disposition
  - session-selection sync
  - `runAssistantPromptTurn`
  - `useAssistantChatController`

Do **not** replace this with a generic `ink/utils.ts`. The seam is behavioral ownership, not "miscellaneous helpers."

**Incremental extraction path**

1. Move the pure composer editing helpers and `ComposerInput` first, with focused tests around cursor moves, word deletion, and multiline edits.
2. Move transcript/message rendering next; keep the prop surface stable so `runAssistantChatWithInk` still renders the same tree.
3. Move the queue/turn reducers and `runAssistantPromptTurn` into a controller module.
4. Leave `runAssistantChatWithInk` in place as the only assembly point until the imports settle.

### 2. `packages/cli/src/commands/assistant.ts`

**Main seam:** assistant command-family ownership.

**Concrete file / symbols**

- root option and argument adapters:
  - `assistantSessionOptionFields`
  - `assistantProviderOptionFields`
  - `assistantDeliveryOptionFields`
  - `assistantCronDeliveryOptionFields`
  - `assistantCronTargetSourceOptionFields`
  - `assistantCronStateOptionFields`
  - `assistantSelfDeliveryTargetOptionFields`
  - `assistantConversationOptionsFromCli`
  - `assistantProviderOverridesFromCli`
  - `assistantDeliveryOverridesFromCli`
  - `resolveAssistantDeliveryRouteFromCli`
  - `assistantCronStateOptionsFromCli`
  - `resolveAssistantCronTargetFromCli`
- command families that already exist as separate local closures:
  - `registerConversationCommands`
  - `registerStateCommands`
  - `registerMemoryCommands`
  - `registerSelfTargetCommands`
  - `registerCronCommands`
  - `registerObservabilityCommands`
  - `registerSessionCommands`
- command-definition builders and helpers:
  - `createAssistantStatusCommandDefinition`
  - `createAssistantDoctorCommandDefinition`
  - `createAssistantStopCommandDefinition`
  - `createAssistantChatCommandDefinition`
  - `createAssistantRunCommandDefinition`
  - `runAssistantChatCommand`

**Why the current shape hurts composability**

This file already tells you what the seams are: the code is organized into local `register*Commands` closures for conversation, state, memory, self-targets, cron, observability, and sessions. The problem is that all of those domains still live in one 2k+ line file and are coupled mainly because they share the `assistant` prefix.

That makes local edits riskier than they need to be. A cron-target change, a memory-schema option change, and a session-listing tweak all land in the same module, compete for the same imports, and force a reader to jump across unrelated command families. The top-level option adapters are also harder to place because family-local parsing and root registration are interleaved.

**Smaller target module boundaries**

Keep `packages/cli/src/commands/assistant.ts` as the assembly shell that creates the root `assistant` command and root aliases.

Extract explicit family modules under `packages/cli/src/commands/assistant/`:

- `conversation.ts`
  - `ask`
  - `deliver`
  - `createAssistantChatCommandDefinition`
  - `runAssistantChatCommand`
  - conversation/provider/delivery CLI adapters
- `state.ts`
  - `assistant state *`
  - state result-path helpers
- `memory.ts`
  - `assistant memory *`
  - memory result-path helpers
- `self-target.ts`
  - `assistant self-target *`
  - `assertAssistantSelfDeliveryTargetInput`
- `cron.ts`
  - `assistant cron *`
  - `parseAssistantCronPresetVariables`
  - cron target/state CLI adapters
- `observability.ts`
  - `createAssistantStatusCommandDefinition`
  - `createAssistantDoctorCommandDefinition`
  - `createAssistantStopCommandDefinition`
- `session.ts`
  - `assistant session *`
- `runtime.ts`
  - `createAssistantRunCommandDefinition`

The root file should mostly read like:

- create `assistant`
- register imported families
- register root aliases

**Incremental extraction path**

1. Move one `register*Commands` closure at a time into a same-named module without changing runtime behavior.
2. Move each family's option parsing helpers with that family instead of creating a generic options grab-bag.
3. Keep `registerAssistantCommands` as the orchestration surface until all family modules are stable.
4. Leave root aliases in the top-level file because they intentionally cut across families.

### 3. `apps/web/src/lib/device-sync/prisma-store.ts`

**Main seam:** one Prisma composition root currently contains several unrelated store implementations.

**Concrete file / symbols**

Distinct store classes already present in the file:

- `PrismaHostedOAuthSessionStore`
- `PrismaHostedConnectionStore`
- `PrismaHostedWebhookTraceStore`
- `PrismaHostedSignalStore`
- `PrismaHostedBrowserAssertionNonceStore`
- `PrismaHostedAgentSessionStore`
- `PrismaHostedLocalHeartbeatStore`
- facade/composition root: `PrismaDeviceSyncControlPlaneStore`

Record and helper clusters currently packed into the same module:

- connection mapping:
  - `hostedConnectionWithSecretArgs`
  - `mapHostedPublicAccountRecord`
  - `requireHostedPublicAccountRecord`
  - `requireHostedConnectionBundleRecord`
- signal and agent-session mapping:
  - `mapHostedSignalRecord`
  - `mapHostedAgentSessionRecord`
- local-heartbeat patch shaping:
  - `resolveLocalHeartbeatErrorPatch`
  - `toPrismaHeartbeatErrorPatch`
- shared persistence helpers:
  - `toPrismaJsonObject`
  - `toNullablePrismaJsonValue`
  - `isUniqueViolation`
- token generation:
  - `generateHostedAgentBearerToken`

**Why the current shape hurts composability**

This is one of the clearest split candidates in the repo because the smaller boundaries already exist as classes. The file is large mostly because many self-contained stores happen to live together, not because the code needs to be read as one unit.

A change to webhook dedupe should not sit in the same file as connection secret encryption, browser assertion nonce consumption, and agent-session rotation. Those are different subdomains with different test fixtures and different failure modes.

`PrismaDeviceSyncControlPlaneStore` already acts as the natural composition root, which means the internal split can happen without changing the public surface.

**Smaller target module boundaries**

Keep `prisma-store.ts` as the composition root and facade only.

Extract:

- `apps/web/src/lib/device-sync/prisma-store/oauth-sessions.ts`
  - `PrismaHostedOAuthSessionStore`
- `apps/web/src/lib/device-sync/prisma-store/connections.ts`
  - `PrismaHostedConnectionStore`
  - `hostedConnectionWithSecretArgs`
  - connection mappers/require helpers
- `apps/web/src/lib/device-sync/prisma-store/webhook-traces.ts`
  - `PrismaHostedWebhookTraceStore`
- `apps/web/src/lib/device-sync/prisma-store/signals.ts`
  - `PrismaHostedSignalStore`
  - `mapHostedSignalRecord`
- `apps/web/src/lib/device-sync/prisma-store/browser-assertion-nonces.ts`
  - `PrismaHostedBrowserAssertionNonceStore`
- `apps/web/src/lib/device-sync/prisma-store/agent-sessions.ts`
  - `PrismaHostedAgentSessionStore`
  - `mapHostedAgentSessionRecord`
  - `generateHostedAgentBearerToken`
- `apps/web/src/lib/device-sync/prisma-store/local-heartbeats.ts`
  - `PrismaHostedLocalHeartbeatStore`
  - heartbeat patch helpers

If the JSON and unique-violation helpers are genuinely shared, give them a narrowly named support module such as `prisma-codecs.ts` or `prisma-errors.ts`. Do not create a vague `helpers.ts`.

**Incremental extraction path**

1. Move the most isolated stores first: OAuth sessions, webhook traces, signals, and browser assertion nonces.
2. Move agent sessions next, keeping token generation next to the agent-session implementation.
3. Move connections and local heartbeats last because they share more mapping and patch helpers.
4. Keep `PrismaDeviceSyncControlPlaneStore`'s constructor and method surface unchanged throughout.

### 4. `packages/cli/src/assistant/outbox.ts`

**Main seam:** intent persistence vs. dispatch execution vs. retry/quarantine policy.

**Concrete file / symbols**

- intent persistence and inventory:
  - `createAssistantOutboxIntent`
  - `readAssistantOutboxIntent`
  - `saveAssistantOutboxIntent`
  - `listAssistantOutboxIntents`
  - `listAssistantOutboxIntentsLocal`
  - `buildAssistantOutboxSummary`
  - `resolveAssistantOutboxIntentPath`
  - `findAssistantOutboxIntentByDedupeKey`
  - `readAssistantOutboxIntentAtPath`
  - `readAssistantOutboxIntentInventoryEntry`
  - target/dedupe helpers such as `buildAssistantOutboxRawTargetIdentity`, `buildAssistantOutboxPersistedTarget`, `hashAssistantOutboxIdentity`, and `hashAssistantOutboxTargetFingerprint`
- dispatch orchestration:
  - `dispatchAssistantOutboxIntent`
  - `deliverAssistantOutboxMessage`
  - `drainAssistantOutbox`
  - `drainAssistantOutboxLocal`
  - `markAssistantOutboxIntentSent`
  - `buildAssistantDeliveryIdempotencyKey`
- retry, quarantine, and error policy:
  - `shouldDispatchAssistantOutboxIntent`
  - `isAssistantOutboxRetryableError`
  - `normalizeAssistantDeliveryError`
  - `resolveAssistantOutboxRetryDelayMs`
  - `updateAssistantOutboxAfterDispatchFailure`
  - `rescheduleAssistantOutboxConfirmationRetry`
  - `createAssistantDeliveryConfirmationPendingError`
  - `quarantineAssistantOutboxIntentFile`
  - `shouldBeginAssistantOutboxDispatch`

**Why the current shape hurts composability**

This file mixes a local intent store, a delivery state machine, and retry/quarantine policy in one module. Readers who only want inventory or summary behavior still have to load the outbound channel dispatch path mentally. Readers changing retry semantics have to reason about receipt updates, file locking, idempotency keys, local JSON storage, and transport error normalization together.

Those concerns are related, but they are not the same boundary.

**Smaller target module boundaries**

Keep a small public entry file if desired, but split along the lifecycle seams that already exist:

- `packages/cli/src/assistant/outbox/intents.ts`
  - intent creation, read/save/list
  - path and dedupe helpers
  - summary building
- `packages/cli/src/assistant/outbox/dispatch.ts`
  - dispatch / deliver / drain
  - sent-marking and idempotency-key creation
- `packages/cli/src/assistant/outbox/retry-policy.ts`
  - retryability classification
  - confirmation-pending retry handling
  - backoff and quarantine behavior

Keep receipt and diagnostics writes next to dispatch/lifecycle code. Do not hide them behind a generic event helper, because ordering matters here.

**Incremental extraction path**

1. Move the pure retry/error helpers first and keep all signatures identical.
2. Move intent inventory and dedupe/path helpers next.
3. Move dispatch orchestration last, once the imports for persistence and policy are stable.
4. Preserve the current lock and receipt-write ordering as an invariant during the split.

### 5. `packages/cli/src/gateway/store.ts`

**Main seam:** source synchronization vs. snapshot materialization vs. permission/event query surface.

**Concrete file / symbols**

- exported façade and local wrappers:
  - `exportGatewayProjectionSnapshotLocal`
  - `listGatewayOpenPermissionsLocal`
  - `respondToGatewayPermissionLocal`
  - `pollGatewayEventsLocal`
  - `waitForGatewayEventsLocal`
  - `LocalGatewayProjectionStore`
- source synchronization:
  - `listAllInboxCapturesByCreatedOrder`
  - `clearCaptureSources`
  - `upsertCaptureSources`
  - `replaceSessionSources`
  - `replaceOutboxSources`
  - `computeSessionSyncSignature`
  - `computeCaptureSyncSignature`
  - `computeOutboxSyncSignature`
- schema / transaction helpers:
  - `ensureGatewayStoreSchema`
  - `withGatewayImmediateTransaction`
  - `readMeta`
  - `writeMeta`
- snapshot rebuild and serving state:
  - `rebuildSnapshotState`
  - `replaceServingSnapshot`
  - `buildSnapshotFromDatabase`
  - `readSnapshotState`
  - `writeSnapshotState`
  - `readStoredSnapshot`
  - `readSnapshotOrEmpty`
  - `readStoredEvents`
  - `readNextCursor`
  - materializers such as `materializeGatewayMessage`, `materializeGatewayAttachmentFromRow`, `materializeGatewayConversation`, and accumulator helpers
- permission mutations:
  - `listOpenPermissionsFromDatabase`
  - `respondToPermissionInDatabase`

**Why the current shape hurts composability**

This file currently owns three separate data problems:

1. importing source state from inbox captures, assistant sessions, and outbox intents
2. building and persisting a gateway serving snapshot
3. reading and mutating permission requests / event cursors

Those surfaces share a database, but they do not need to share one file. A change to permission-response behavior should not force a reader through snapshot accumulation and capture hydration. A change to snapshot materialization should not land beside session/outbox source replacement code unless the database schema really changes.

**Smaller target module boundaries**

Keep `LocalGatewayProjectionStore` and the exported local wrapper functions in `packages/cli/src/gateway/store.ts`.

Extract:

- `packages/cli/src/gateway/store/schema.ts`
  - schema creation
  - transaction helper
  - meta read/write
- `packages/cli/src/gateway/store/source-sync.ts`
  - capture/session/outbox source replacement
  - sync-signature helpers
- `packages/cli/src/gateway/store/snapshot.ts`
  - snapshot rebuild
  - stored snapshot/event reads
  - materialization helpers
- `packages/cli/src/gateway/store/permissions.ts`
  - permission query and response persistence

**Incremental extraction path**

1. Move snapshot materialization helpers first; they are the clearest self-contained seam.
2. Move permission read/write next because it is small and behaviorally distinct.
3. Move source synchronization last because it reaches into inbox and assistant state.
4. Keep `LocalGatewayProjectionStore` as the only public assembly point.

### 6. `packages/inboxd/src/indexing/persist.ts`

**Main seam:** raw capture persistence vs. canonical evidence/append logic vs. runtime rebuild.

**Concrete file / symbols**

- raw capture persistence:
  - `persistRawCapture`
  - `prepareRawCapturePersistence`
  - `buildSanitizedInboundCapture`
  - `buildInboxCaptureDirectory`
- canonical append helpers:
  - `persistCanonicalInboxCapture`
  - `buildInboxCaptureRecord`
  - `buildInboxCaptureEventRecord`
  - `buildInboxCaptureAuditRecord`
  - `buildInboxCaptureLedgerPathForOccurredAt`
  - `buildInboxCaptureEventPathForOccurredAt`
  - `buildInboxCaptureAuditPathForStoredAt`
- stored-envelope lookup and canonical evidence repair:
  - `findStoredCaptureEnvelope`
  - `ensureStoredCaptureCanonicalEvidence`
  - `appendInboxCaptureEvent`
  - `appendImportAudit`
  - `UnsafeStoredCaptureIdError`
- runtime rebuild:
  - `rebuildRuntimeFromVault`

**Why the current shape hurts composability**

These are related inbox ingestion flows, but they are different responsibilities with different callers:

- persisting raw inbound payloads and attachments
- writing canonical capture/event/audit records
- repairing or confirming canonical evidence for already stored captures
- rebuilding the runtime view from vault state

Today they are coupled because they all touch the stored capture envelope, not because they are one inseparable behavior. That makes tests broader and makes it harder to change one path without reloading the rest.

**Smaller target module boundaries**

Keep a thin public entrypoint if desired, but split by flow:

- `packages/inboxd/src/indexing/persist/raw-capture.ts`
  - raw envelope preparation and raw persistence
- `packages/inboxd/src/indexing/persist/canonical-records.ts`
  - canonical record builders and canonical persist path
- `packages/inboxd/src/indexing/persist/evidence.ts`
  - envelope lookup, evidence repair, append helpers, unsafe-id handling
- `packages/inboxd/src/indexing/persist/rebuild-runtime.ts`
  - vault-to-runtime rebuild

**Incremental extraction path**

1. Move the canonical record builders and shard-path helpers first; they are already a coherent cluster.
2. Move raw persistence next, keeping the envelope shape unchanged.
3. Move evidence repair and append helpers after that.
4. Move `rebuildRuntimeFromVault` last so the runtime rebuild path stays stable while the persistence modules are settling.

## worth planning

### 1. `packages/core/src/mutations.ts`

**Main seam:** public mutation entrypoints vs. shared record-build/staging helpers vs. device-batch planning.

**Concrete file / symbols**

Public mutation entrypoints:

- `importDocument`
- `addMeal`
- `importSamples`
- `importDeviceBatch`

Shared record-building and append-plan helpers:

- event record helpers:
  - `buildNormalizedEventSeed`
  - `materializeEventRecord`
  - `finalizeEventRecord`
  - `buildEventRecord`
  - `prepareEventRecord`
- sample record helpers:
  - `buildNormalizedSampleSeed`
  - `materializeSampleRecord`
  - `finalizeSampleRecord`
  - `buildSampleRecord`
- JSONL staging helpers:
  - `readExistingRecordIds`
  - `buildJsonlAppendPlan`
  - `stageJsonlAppendPlan`
- device-batch normalization/planning:
  - `normalizeDeviceEventInputs`
  - `normalizeDeviceSampleInputs`
  - `normalizeDeviceRawArtifactInputs`
  - `normalizeDeviceBatchInputs`
  - `prepareDeviceRawArtifacts`
  - `prepareDeviceEventEntries`
  - `prepareDeviceSampleEntries`
  - `prepareDeviceBatchPlan`

**Why the current shape hurts composability**

The file mixes generic canonical record preparation with device-specific batch planning and the public mutation entrypoints that orchestrate writes. That creates a lot of internal surface area for one module.

I would not split this immediately because it sits on top of canonical write ordering and idempotency-sensitive staging. The right split is visible, but the blast radius is large enough that the first extraction should be careful and test-led.

**Smaller target module boundaries**

Keep `packages/core/src/mutations.ts` as the public facade initially.

Plan extractions into:

- `packages/core/src/mutations/event-records.ts`
- `packages/core/src/mutations/sample-records.ts`
- `packages/core/src/mutations/jsonl-append-plan.ts`
- `packages/core/src/mutations/device-batch.ts`

**Incremental extraction path**

1. Extract the pure event/sample record builders first.
2. Extract JSONL append-plan helpers next without changing `WriteBatch` ordering.
3. Extract device-batch normalization and planning last.
4. Leave the exported mutation entrypoints in `mutations.ts` until the helper seams are stable.

### 2. `packages/query/src/model.ts`

**Main seam:** vault loading vs. read-model shaping vs. selector/query helpers.

**Concrete file / symbols**

- read-model shaping:
  - `VaultReadModel`
  - `ALL_VAULT_RECORD_TYPES`
  - `VAULT_FAMILY_VIEW_SPECS`
  - `createVaultReadModel`
  - `deriveVaultFamilyViews`
  - `deriveVaultReadModelViews`
  - `toVaultRecord`
  - `groupRecordsByFamily`
  - `firstRecordOfType`
  - `recordsOfType`
- vault loading:
  - `readVault`
  - `readVaultTolerant`
  - `readVaultWithHealthMode`
  - `readBaseEntities`
  - `readOptionalCoreEntity`
  - `readExperimentEntities`
  - `readJournalEntities`
  - `readJsonlRecordFamily`
  - `readSampleEntities`
- selector/query helpers:
  - `getVaultEntities`
  - `lookupEntityById`
  - `listEntities`
  - `lookupRecordById`
  - `listRecords`
  - `listExperiments`
  - `getExperiment`
  - `listJournalEntries`
  - `getJournalEntry`
  - `matchesRecordLikeFilter`
  - `recordRelationTargetIds`

**Why the current shape hurts composability**

`model.ts` is both the IO layer that loads the vault, the module that shapes the read model, and the place that houses many selectors over that model. Those are meaningful seams, but this file is also a very central public API for query consumers, so an abrupt split would create a lot of import churn.

The right move is to preserve one public facade and peel off the pure selector/read-model pieces first.

**Smaller target module boundaries**

- `packages/query/src/model.ts`
  - keep the public facade and stable exports
- `packages/query/src/model/loaders.ts`
  - vault loading and file walking
- `packages/query/src/model/read-model.ts`
  - read-model shaping helpers and record-family grouping
- `packages/query/src/model/selectors.ts`
  - query helpers over `VaultReadModel`

**Incremental extraction path**

1. Move selectors first; they are the least invasive split.
2. Move read-model shaping helpers next.
3. Leave the top-level `readVault*` exports in place as a facade until downstream imports are migrated.

### 3. `packages/cli/src/setup-wizard.ts`

**Main seam:** wizard domain/model logic vs. Ink presentation helpers vs. the long-running wizard runner.

**Concrete file / symbols**

- public runner:
  - `runSetupWizard`
- domain/model helpers:
  - `inferSetupWizardAssistantProvider`
  - `resolveSetupWizardAssistantSelection`
  - `buildSetupWizardPublicUrlReview`
  - `describeSetupWizardPublicUrlStrategyChoice`
  - the option sorting/toggling helpers that support those decisions
- presentation helpers:
  - `createSetupWizardPanel`
  - `createSetupWizardSelectionRow`
  - `createSetupWizardAnsweredBlock`
  - `createSetupWizardBulletRow`
  - `createSetupWizardKeyValueRow`
  - `createSetupWizardPublicUrlTargetRow`
  - `createSetupWizardHintRow`

**Why the current shape hurts composability**

This file is big partly because the setup wizard is a real single flow, so I would not rush to fragment it. But it still contains at least three distinct layers:

- pure setup decision logic
- reusable Ink presentation blocks
- the stateful runner that coordinates the flow

That is enough to warrant planning an extraction, especially because the pure selection/public-url helpers are already useful independently of the runner.

**Smaller target module boundaries**

- `packages/cli/src/setup-wizard.ts`
  - keep `runSetupWizard` initially
- `packages/cli/src/setup-wizard/model.ts`
  - provider and public-url decision helpers
- `packages/cli/src/setup-wizard/view.tsx`
  - panel/row/hint rendering helpers
- if still warranted later: `packages/cli/src/setup-wizard/app.tsx`
  - the internal Ink app extracted from `runSetupWizard`

**Incremental extraction path**

1. Move the pure model helpers first.
2. Move the repeated presentation helpers next.
3. Split the internal app from `runSetupWizard` only after the state model is stable.

### 4. `packages/cli/src/assistant-codex.ts` and `packages/assistant-core/src/assistant-codex.ts`

**Main seam:** process execution vs. event normalization/trace extraction vs. error/display handling, with duplicated ownership across packages.

**Concrete file / symbols**

- process execution and I/O:
  - `executeCodexPrompt`
  - `attachCodexAbortListener`
  - `consumeCompleteLines`
  - `tryParseJsonLine`
  - `buildCodexArgs`
- display/config:
  - `resolveCodexDisplayOptions`
  - `readCodexDisplayConfig`
  - `parseCodexDisplayConfig`
- normalized event parsing:
  - `normalizeCodexEvent`
  - `extractCodexProgressEventFromNormalized`
  - `extractCodexTraceUpdates`
  - `extractCodexTraceUpdatesFromNormalized`
- failure shaping:
  - `buildCodexFailure`
  - `buildCodexInterruptedError`
  - `buildCodexConnectionFailureMessage`
  - `buildCodexFailureMessage`

**Why the current shape hurts composability**

Each copy of this file mixes execution, stream parsing, normalized event extraction, display config reading, and error classification. That is already enough internal sprawl to justify a future split.

However, the bigger issue is that the file currently exists twice with the same content. Choosing the owning package is the first step. Splitting both copies independently would just double the migration work.

**Smaller target module boundaries**

Pick one shared owner first, then split internally into:

- `codex/exec.ts`
- `codex/display-config.ts`
- `codex/events.ts`
- `codex/errors.ts`

Then keep the existing entrypoint path as a thin re-export or facade until imports are migrated.

**Incremental extraction path**

1. Choose the shared owner first so the duplication stops growing.
2. Extract pure event normalization and error builders before touching process execution.
3. Repoint both current import surfaces at the shared owner.
4. Split execution/config only after the shared owner is in place.

### 5. `packages/inboxd/src/kernel/sqlite.ts`

**Main seam:** schema/setup vs. capture hydration/storage vs. parse-job queue vs. search surface.

**Concrete file / symbols**

- public runtime surface:
  - `openInboxRuntime`
  - `createInboxRuntimeStore`
- row decoding and hydration:
  - `decodeCaptureRows`
  - `decodeAttachmentRows`
  - `decodeAttachmentParseJobRows`
  - `decodeSearchRows`
  - `hydrateCaptureRows`
  - `loadAttachmentRows`
  - `hydrateCaptureAttachments`
  - `hydrateCaptureRow`
- search/indexing:
  - `normalizeCaptureFilters`
  - `createSearchHitFromCapture`
  - `createSearchHitFromRow`
  - `refreshCaptureSearchIndex`
- attachment parse-job queue:
  - `shouldEnqueueParseJob`
  - `readAttachmentParseJob`
- schema helpers:
  - `ensureColumn`
  - related setup/migration logic inside `openInboxRuntime` / `createInboxRuntimeStore`

**Why the current shape hurts composability**

This file is still centered on one real boundary — the SQLite runtime store — so I would not split it aggressively yet. But the internal seams are visible, especially between capture hydration, search indexing, and parse-job queue behavior.

The reason this is `worth planning` rather than `split now` is that SQL text, row decoders, and hydration logic are tightly coupled. A sloppy extraction could make the store harder to follow, not easier.

**Smaller target module boundaries**

When the tests are ready, split into:

- `kernel/sqlite/schema.ts`
- `kernel/sqlite/captures.ts`
- `kernel/sqlite/search.ts`
- `kernel/sqlite/attachment-parse-jobs.ts`

Keep `openInboxRuntime` as the stable facade.

**Incremental extraction path**

1. Extract search helpers first.
2. Extract parse-job queue helpers next.
3. Leave schema/bootstrap and capture hydration in place until round-trip tests are strong enough.

## keep together

### 1. `packages/core/src/operations/write-batch.ts`

**Main seam:** canonical write transaction / recovery boundary.

**Concrete file / symbols**

- `runCanonicalWrite`
- `WriteBatch`
- `listWriteOperationMetadataPaths`
- `readStoredWriteOperation`
- `readRecoverableStoredWriteOperation`
- guard-receipt helpers
- protected-path helpers such as `isProtectedCanonicalPath` and `listProtectedCanonicalPaths`

**Why this large file should stay intact**

This file is big, but most of that size belongs to one real state machine: staging, applying, recording, and recovering canonical writes. The helper functions here are not several unrelated seams crammed together; they are supporting pieces of the same durable-write boundary.

Splitting it too early would make the ordering invariants harder to see. Readers need to understand stage/apply/recover together, and this file keeps that lifecycle legible in one place.

**What to do instead**

Keep the file intact for now. Only extract tiny internal helpers later if a test seam becomes obvious, and keep `runCanonicalWrite` / `WriteBatch` as the single coordination boundary.

### 2. `packages/cli/src/assistant-cli-contracts.ts` and `packages/assistant-core/src/assistant-cli-contracts.ts`

**Main seam:** assistant local-state contract surface.

**Concrete file / symbols**

Representative schema clusters in the file:

- `assistantSessionSchema`
- `assistantTranscriptEntrySchema`
- `assistantTurnReceiptSchema`
- `assistantOutboxIntentSchema`
- `assistantStatusResultSchema`
- `assistantDoctorResultSchema`
- `assistantMemoryRecordSchema`
- `assistantCronScheduleSchema`

**Why this large file should stay intact**

This file is huge, but the size mostly reflects a broad schema boundary, not accidental responsibility sprawl. It is the local-state contract surface for the assistant runtime. Splitting it into many tiny files like `session-schemas.ts`, `cron-schemas.ts`, `memory-schemas.ts`, and `doctor-schemas.ts` would likely make cross-schema changes noisier and weaken the sense that these records belong to one versioned contract family.

The real maintenance problem here is the duplicated ownership across two packages, not the internal size of one schema module.

**What to do instead**

Keep the schema family together. If you act here, consolidate the duplicate copies behind one shared owner or facade. Do not split purely by line count.

### 3. `packages/device-syncd/src/providers/oura.ts`

**Main seam:** one provider implementation boundary.

**Concrete file / symbols**

- `createOuraDeviceSyncProvider`
- `resolveOuraWebhookVerificationChallenge`
- `OURA_RESOURCE_DESCRIPTORS`
- `fetchOuraHeartRateInChunks`
- OAuth/webhook/resource-window helpers that support the provider

**Why this large file should stay intact**

This file is large because Oura-specific OAuth handling, webhook validation, snapshot collection, delete handling, and resource descriptors all belong to one provider boundary. They change together more often than they would be reused elsewhere.

A premature split here would probably produce `oura-utils.ts` style modules with one caller and weaker locality.

**What to do instead**

Keep the provider implementation together. Only extract a submodule later if a clearly reusable seam appears, such as a resource-descriptor table or a webhook-signature helper shared by multiple provider files.

### 4. `packages/device-syncd/src/http.ts`

**Main seam:** device-syncd HTTP transport surface.

**Concrete file / symbols**

- `startDeviceSyncHttpServer`
- `DEVICE_SYNC_HTTP_ROUTES`
- `routeRequest`
- transport helpers such as `maybeReadJsonBody`, `sendJson`, `sendHtml`, `sendText`, and `redirect`
- callback/public error rendering:
  - `buildCallbackErrorRedirectLocation`
  - `buildPublicDeviceSyncErrorPayload`
  - `renderCallbackHtml`

**Why this large file should stay intact**

This module is serving as the single Node HTTP surface for device-syncd. Route matching, request parsing, response helpers, callback HTML rendering, and public error shaping all belong to that transport boundary today.

If it were split right now, the likely outcome would be pass-through modules for route tables and transport helpers without a clearer ownership model.

**What to do instead**

Keep the file together until a stronger boundary appears, such as a second listener surface or a route family that grows enough to deserve its own module. If that happens, split by listener surface or route family — not by tiny helper type.
