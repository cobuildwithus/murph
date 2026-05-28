I did one more pass against `main` and tightened the plan. The biggest correction is this: **do not delete transcript persistence wholesale.** Transcripts currently support accepted-turn input refs, audit, receipts, and active-turn bookkeeping. The clean cut is to remove **transcript replay as model continuity**, not to delete transcript storage.

This guide incorporates your three uploaded architecture notes and the final `main` review.   

# Final migration guide: Codex owns continuity; Murph owns routing and runtime side effects

## Final target architecture

```txt
Codex App Server owns:
  - thread history
  - native resume
  - Codex rollout/session files
  - provider compaction / provider-side continuity

Murph owns:
  - conversation binding and aliasing
  - delivery/outbox/receipts/diagnostics
  - active-turn input journals
  - audit transcripts
  - target selection and route safety checks
  - hosted checkpoint completeness for the Codex thread pointer

Murph must not own:
  - reconstructed model history
  - provider-neutral assistant session continuity
  - alternate Murph-side conversation memory
```

The architecture doc already points in this direction: assistant runtime state is non-canonical execution residue, session persistence stores one Codex App Server target plus separate resume metadata, and provider-native resume state is the continuity authority when present. 

The durable assistant record should eventually be boring:

```ts
type AssistantConversation = {
  schema: 'murph.assistant-conversation.v2'
  conversationId: string

  alias: string | null
  binding: AssistantSessionBinding

  codexTarget: CodexTarget

  codexResume: {
    threadId: string
    routeFingerprint: string
    rolloutRelativePath: string | null
  } | null

  createdAt: string
  updatedAt: string
  lastTurnAt: string | null
  turnCount: number
}
```

Do **not** persist these as durable fields in the new model:

```ts
provider                 // always Codex internally
providerOptions          // derived from codexTarget
executionDriver          // always codex-app-server
resumeKind               // always codex-thread
continuityContext         // dead/null
conversationMessages      // not durable continuity
threadInstructionsFingerprint // remove from ordinary resume path
```

---

# Current `main` facts that shaped the final plan

`main` is already Codex-only in substance. `target-runtime.ts` only exposes `codex-app-server` and `codex-thread`; non-Codex runtime targets throw.  The provider config layer only accepts `codex-cli`, normalizes everything into a Codex target, and resolves Codex runtime capability/continuity from that target.  The registry is a generic-looking wrapper around Codex execution and asserts that the provider is Codex. 

The real resume path is Codex-native. `providers/codex-cli.ts` passes `resumeSessionId` to `executeCodexAppServerTurn`, and returns `providerSessionId` plus `codexRolloutRelativePath` from the Codex result. It also has fresh-thread fallback on stale/invalid resume failures.  `assistant-codex.ts` starts/resumes Codex threads and derives the rollout relative path from Codex home and the returned thread path. 

Murph still owns useful non-Codex state. `resolveAssistantSession` currently resolves by explicit session id, alias, and conversation key; creates a durable local record with target, binding, timestamps, turn count, and resume state; and maintains session/index/transcript state.  Binding logic is real product logic: it computes conversation keys, prevents binding isolation conflicts, infers delivery routes, and builds route context lines. Codex cannot replace this. 

Transcripts are not only historical replay. The local service appends transcript entries to create transcript refs for accepted-turn inputs and active-turn continuations.  The accepted-turn input journal requires stable transcript coordinates when transcript refs are updated.  So transcript persistence stays, but it stops being a continuity source.

---

# Phase 1: remove dead continuity plumbing

## 1. Remove `AssistantExecutionPlan.resumeState`

This is a pure leftover. `resolveAssistantExecutionPlan` accepts/returns `resumeState`, but route construction uses target/provider config, not resume state.  `service-turn-routes.ts` passes `resolved.session.resumeState` into `resolveAssistantExecutionPlan` and only uses `.codexRoute`. 

Cut:

```ts
AssistantExecutionPlan.resumeState
resolveAssistantExecutionPlan(input.resumeState)
service-turn-routes.ts passing resumeState into execution-plan
```

Do not change actual resume behavior yet; that happens later in turn planning.

## 2. Remove `continuityContext`

`provider-turn/planning.ts` returns `continuityContext: null`.  It is still present in service/provider types and forwarded through execution.  

Cut it from:

```txt
service-contracts.ts
provider-turn/planning.ts
provider-turn-runner.ts
providers/types.ts
providers/registry.ts
providers/helpers.ts
providers/codex-cli.ts
tests that construct AssistantRouteTurnPlan
```

This removes the last generic “Murph-supplied continuity blob” concept. Resume is now only `codexThreadId`.

## 3. Delete stale duplicate service-contract planning types

`service-contracts.ts` defines `AssistantRouteTurnPlan`, `AssistantProviderTurnExecutionPlan`, and `AssistantProviderAttemptPlan`, while `provider-turn/planning.ts` defines the real richer versions used by the runner. Search only finds the service-contracts definitions and the provider-turn versions.  

After removing `continuityContext`, delete the stale service-contracts versions unless a direct import proves they are still needed.

---

# Phase 2: make Codex resume state single-owner and minimal

## 4. Centralize resume-state validation

Right now the resume-state shape is normalized in two places.

`assistant-cli-contracts.ts` defines `assistantSessionResumeStateSchema`, validates `providerSessionId`, `resumeRouteId`, `codexRolloutRelativePath`, and `threadInstructionsFingerprint`, and normalizes resume state without a provider session id to null.  `provider-state.ts` duplicates the rollout regex, thread-instructions fingerprint regex, and helper normalization logic. 

Create one owner:

```txt
packages/operator-config/src/assistant/codex-resume-state.ts
```

Recommended API:

```ts
export type CodexResumeState = {
  threadId: string
  routeFingerprint: string
  rolloutRelativePath?: string | null
}

export function normalizeCodexResumeState(value: unknown): CodexResumeState | null
export function buildCodexResumeState(input: {
  threadId: string | null | undefined
  routeFingerprint: string | null | undefined
  rolloutRelativePath?: string | null
}): CodexResumeState | null
```

Then reduce `provider-state.ts` to temporary compatibility wrappers or delete it.

## 5. Rename resume fields internally

Keep backward-compatible JSON parsing for one migration window, but use Codex names everywhere internally.

```txt
providerSessionId       -> codexThreadId / threadId
resumeProviderSessionId -> resumeCodexThreadId
resumeRouteId           -> routeFingerprint
providerResumeState     -> codexResume
provider-state.ts       -> codex-resume-state.ts
provider-binding.ts     -> codex-resume-binding.ts
provider-route.ts       -> codex-thread-identity.ts
```

Keep the persisted v1 parser tolerant:

```ts
// v1 input
{
  providerSessionId,
  resumeRouteId,
  codexRolloutRelativePath,
  threadInstructionsFingerprint
}

// v2 normalized output
{
  codexResume: {
    threadId,
    routeFingerprint,
    rolloutRelativePath
  }
}
```

## 6. Keep the route safety guard

Do **not** remove this. `provider-route.ts` hashes Codex command, model, model provider, reasoning effort, sandbox, approval policy, profile, OSS mode, normalized Codex home, and resume kind into `routeId`.  `provider-binding.ts` only resumes when the stored route id exactly matches the current route id, specifically to avoid resuming the wrong upstream thread after target changes. 

Rename it; do not delete it.

Preferred name:

```ts
routeFingerprint
```

Possible implementation:

```ts
const routeFingerprint = hash({
  codexCommand,
  codexHomeNormalizedForHosted,
  targetContinuityFingerprint,
})
```

Be careful here: `providerOptions.continuityFingerprint` and `routeId` overlap but are not identical. `routeId` also includes `codexCommand`. Do not collapse them until tests prove no safety information is lost.

---

# Phase 3: remove transcript replay as model continuity

## 7. Cut transcript replay from provider planning

`provider-turn/planning.ts` currently calls `resolveAssistantTranscriptConversationMessages` when all of these are true:

```txt
promptProfile === conversation
resumeProviderSessionId === null
session.turnCount > 0
threadScope === session-thread
```

It then selects up to 12 replay messages from Murph transcripts. 

Remove:

```ts
resolveAssistantTranscriptConversationMessages
selectAssistantReplayMessages
toAssistantReplayMessage
conversationMessages from historical Murph transcript fallback
```

Then remove `conversationMessages` from Codex prompt input unless it is still needed only for active-turn in-memory history. The active-turn path has a separate `activeTurnMessages`/`activeTurnHistory` mechanism and should not depend on durable transcript replay. 

New behavior:

```txt
Existing Murph conversation with valid Codex thread:
  resume Codex thread.

Existing Murph conversation without Codex thread:
  start a fresh Codex thread.

Old transcript exists but no Codex thread:
  do not reconstruct model continuity from transcript.
```

## 8. Keep transcript persistence for audit and active-turn refs

Do **not** remove `appendAssistantTranscriptEntries`, transcript files, or transcript refs in this phase.

Reasons:

`local-service.ts` persists user prompts and accepted active-turn inputs to transcript files, then stores transcript refs in accepted-turn input journals.  `active-turn-input-journal.ts` validates that transcript refs use the original session id and materialized entry coordinates. 

Rename intent:

```txt
transcript replay retention -> transcript audit retention
conversationMessages        -> remove from continuity
transcripts                 -> audit/UI/active-turn refs only
```

## 9. Remove replay retention language

`store/persistence.ts` has `ASSISTANT_TRANSCRIPT_REPLAY_RETENTION_LIMIT = 100` and `pruneAssistantTranscriptRetention`.  After removing replay, either:

```ts
ASSISTANT_TRANSCRIPT_AUDIT_RETENTION_LIMIT
pruneAssistantTranscriptAuditRetention
```

or remove automatic transcript pruning if audit retention should be policy-driven elsewhere.

Do not keep “replay” in names.

---

# Phase 4: make ordinary Codex resume thinner

## 10. Stop refreshing thread instructions by default on resume

`assistant-codex/app-server-requests.ts` sends `developerInstructions` on `thread/resume` unless `refreshThreadInstructions === false`.  Planning computes `threadInstructionsFingerprint`, compares it with stored state, and may request refresh. 

Clean behavior:

```txt
new Codex thread:
  send full bootstrap/system/developer instructions

ordinary Codex resume:
  send threadId + excludeTurns only

explicit migration/debug mode:
  may refresh thread instructions, but not normal hot path
```

So remove `threadInstructionsFingerprint` from persisted resume state, or leave it only as a temporary v1 field ignored by ordinary resume.

This aligns with the architecture doc’s rule that provider-native resume is the continuity authority and bootstrap/system instructions should not be repeatedly injected as resumed-turn user content. 

## 11. Keep bootstrap injection for new threads

Do not delete bootstrap context, CLI surface bootstrap, vault overview, active experiment context, binding context, or onboarding guidance. Planning still needs to construct first-turn context for new Codex threads. 

Only remove the “recompute and refresh persisted thread instructions on ordinary resume” behavior.

---

# Phase 5: make failure/fallback persistence safe

## 12. Do not persist recovered Codex pointers on provider failure

Provider failure diagnostics now live in `provider-failure-diagnostics.ts`.
They may extract a recovered provider session id from connection-lost/interrupted errors only to annotate `recoveredCodexThreadId` on the error context.
They must not return, attach, or persist a recovered assistant session.

Hard-cut rule:

```ts
annotateRecoveredCodexThreadIdForDiagnostics(error)
```

```txt
attach recovered codexThreadId to error diagnostics only
```

Only `persistAssistantTurnAndSession` after successful provider completion should persist a new Codex resume pointer. `turn-finalizer.ts` already builds the next resume state from the successful provider result’s `providerSessionId`, route id, rollout path, and thread-instruction fingerprint.  After the migration, that should become:

```ts
codexResume: buildCodexResumeState({
  threadId: providerResult.codexThreadId,
  routeFingerprint: providerResult.route.routeFingerprint,
  rolloutRelativePath: providerResult.codexRolloutRelativePath,
})
```

## 13. Treat fresh-thread fallback as a successful new thread only after commit

`providers/codex-cli.ts` can start a fresh Codex thread after stale resume or invalid-output resume failure.  That behavior is fine. The important rule:

```txt
Fresh fallback thread id may be persisted only if:
  - provider attempt ultimately succeeds,
  - turn finalization runs,
  - hosted runtime can later checkpoint the matching Codex rollout state.
```

Do not persist fallback thread ids in the provider adapter or failure-recovery layer.

---

# Phase 6: rename/collapse the Codex-only provider abstraction

## 14. Rename internal provider vocabulary to Codex vocabulary

This can be noisy, so do it after semantic cuts above.

Current code still has:

```txt
AssistantProviderConfig
AssistantProviderSessionOptions
AssistantProviderTurnExecutionInput
providerSessionId
resumeProviderSessionId
providerContinuation
provider-route.ts
provider-binding.ts
provider-turn-runner.ts
providers/registry.ts
```

But only `codex-cli` is supported in contracts and runtime.  

Recommended internal names:

```txt
AssistantProviderConfig              -> CodexAssistantConfig
AssistantProviderSessionOptions      -> CodexThreadOptions
AssistantProviderTurnExecutionInput  -> CodexTurnExecutionInput
AssistantProviderTurnExecutionResult -> CodexTurnExecutionResult
providerSessionId                    -> codexThreadId
resumeProviderSessionId              -> resumeCodexThreadId
providerContinuation                 -> codexContinuation
provider-route.ts                    -> codex-thread-route.ts
provider-binding.ts                  -> codex-resume-binding.ts
provider-turn-runner.ts              -> codex-turn-runner.ts
providers/codex-cli.ts               -> codex-app-server-provider.ts
```

Keep public compatibility wrappers temporarily if CLI/API callers still import provider-shaped types. `service.ts` and the CLI wrapper still expose `openAssistantConversation`, `sendAssistantMessage`, and `updateAssistantSessionOptions`.  

## 15. Collapse registry wrappers only after names settle

The provider registry wrapper is not buying multi-provider composability anymore, but deleting it in the same PR as semantic changes will be noisy. Defer this until after resume-state and replay cuts.

Final shape:

```ts
executeCodexTurn(...)
resolveCodexTargetCapabilities(...)
resolveCodexModelCatalog(...)
```

No generic provider registry in the hot path.

---

# Phase 7: shrink “session store” into “conversation binding store”

## 16. Do not delete Murph session metadata immediately

Murph still needs stable ids for:

```txt
outbox intents
turn receipts
accepted-turn input journals
transcript refs
diagnostics
delivery routing
status/listing
manual aliases
conversation lookup keys
```

`runtime-state-service.ts` exposes sessions, transcripts, outbox, status, diagnostics, and turns as one vault-bound facade.  The local service depends on the session id across receipts, accepted-input journals, delivery, active-turn input, and finalization. 

So the migration should be a schema/meaning change, not a blind deletion.

## 17. Introduce `AssistantConversation` v2

Add:

```ts
schema: 'murph.assistant-conversation.v2'
```

Persist only:

```ts
conversationId
alias
binding
codexTarget
codexResume
createdAt
updatedAt
lastTurnAt
turnCount
```

Do not persist derived provider/runtime projection fields.

Keep a v1 parser:

```ts
AssistantSession v1 -> AssistantConversation v2
```

Mapping:

```txt
sessionId                   -> conversationId
target                      -> codexTarget
resumeState.providerSessionId -> codexResume.threadId
resumeState.resumeRouteId     -> codexResume.routeFingerprint
resumeState.codexRolloutRelativePath -> codexResume.rolloutRelativePath
alias                       -> alias
binding                     -> binding
timestamps/turnCount        -> same
provider/providerOptions    -> derive only, do not persist in v2
```

## 18. Keep `sessionId` as a compatibility alias during migration

Because many stores key off `sessionId`, do not rename every id in the first v2 PR.

Internally:

```ts
conversationId: string
```

Compatibility:

```ts
sessionId = conversationId
```

Then move dependent stores later:

```txt
turn receipts
outbox intents
transcript refs
accepted-turn journals
diagnostics
status snapshots
```

This avoids breaking the active-turn transcript-ref invariant in `active-turn-input-journal.ts`. 

## 19. Stop pre-creating provider-continuity on open

`openAssistantConversationLocal()` currently calls `resolveAssistantSession(...)`, which may create a durable assistant session before Codex has minted a thread.  That is the old session model leaking through.

Target behavior:

```txt
openAssistantConversation:
  - resolve/preview binding and target
  - optionally create a binding draft
  - never create codexResume
  - never imply Codex continuity exists

sendAssistantMessage:
  - creates/upserts conversation binding if missing
  - persists codexResume only after successful Codex turn finalization
```

Compatibility path:

```ts
openAssistantConversation() -> returns AssistantConversationPreview
```

Temporary wrapper:

```ts
openAssistantConversationLegacy() -> creates v1/v2 binding record if existing CLI/daemon UI requires an id
```

Do this after v2 schema exists, not before.

---

# Phase 8: hosted checkpoint rules

## 20. Keep `codexRolloutRelativePath` for now

Do not remove rollout paths yet. Hosted snapshots include only Codex rollout JSONL files explicitly referenced by live assistant session resume state, and foreground turns rely on normal workspace snapshotting for provider-native continuity.  `runtime-state/hosted-bundles.ts` has explicit hosted Codex continuity collection/diagnostics around prepared thread ids and rollout relative paths. 

Remove `codexRolloutRelativePath` only if hosted snapshotting can prove continuity another way.

## 21. Checkpoint invariant

After this migration, every hosted checkpoint must satisfy:

```txt
If AssistantConversation.codexResume.threadId is present:
  checkpoint must include the matching Codex rollout file/state.

If matching Codex state cannot be included:
  checkpoint must fail or clear codexResume before publish.
```

Do not publish a workspace checkpoint where Murph points to a Codex thread but the Codex home state needed to resume it is missing.

## 22. No legacy hosted repair found on current `main`

I searched current `main` for `repairLegacyHostedWorkspaceSnapshotProviderContinuity`, `legacy_codex_resume_repaired`, and `hosted-provider-continuity-repair`; I did not find an active path.

So the migration guide should **not** include deleting a current `hosted-provider-continuity-repair.ts` file unless it exists outside indexed code. The right instruction is:

```txt
Do not add new hosted repair complexity for old Murph-owned continuity.
If old snapshots lack Codex continuity, either cold-start them or run a one-time migration tool outside the hot path.
```

---

# Edge-case matrix

## Existing conversation has matching Codex resume

```txt
codexResume.threadId present
routeFingerprint matches current route
threadScope === session-thread
```

Expected:

```txt
resume Codex thread
do not send transcript replay
do not refresh thread instructions by default
persist updated codexResume only after success
```

## Existing conversation has route mismatch

Current `updateAssistantSessionOptionsLocal` clears `resumeState` when continuity fingerprint changes.  Keep that behavior conceptually.

Expected:

```txt
clear codexResume
start fresh Codex thread
do not reuse stale Codex thread
```

## Existing conversation has transcript but no Codex resume

Expected after hard cut:

```txt
start fresh Codex thread
keep transcript for audit/UI
do not replay transcript into prompt as continuity
```

## Resume stale / Codex invalid-output resume failure

Current provider can fresh-thread fallback.  Keep fallback.

Expected:

```txt
fresh fallback thread can become new codexResume only after successful turn commit
```

## Provider failure with recovered thread id

Expected after migration:

```txt
diagnostics may record recovered codexThreadId
session/conversation store must not persist it on failure
```

## Notification / cron / isolated thread

`notification-turn.ts` uses a notification-decision profile and still persists provider resume if a provider session id returns.  `provider-turn/planning.ts` currently isolates automation-cron and notification-decision unless explicitly overridden in profile rules. 

Expected:

```txt
session-thread notification decisions may resume if intentionally configured
isolated-thread turns preserve existing codexResume and do not clear it
```

Check this carefully because `notification-turn.ts` currently sets `threadScope: 'session-thread'` for notification decisions.  If the product intent is “notifications should not mutate conversation continuity,” make that explicit and set isolated thread. Do not let this be implicit.

## Active-turn continuation

Expected:

```txt
keep activeTurnHistory in memory for the same in-flight turn
keep accepted-turn input journals
keep transcript refs
do not use durable transcript replay for next-turn model continuity
```

## Rich user message content

Provider runner filters unsupported rich content by Codex target capability. Tests assert unsupported file/PDF parts are dropped while images pass through. 

Expected:

```txt
no change
```

## Hosted snapshot

Expected:

```txt
checkpoint includes matching Codex rollout file for every stored codexResume
```

## Secrets

Session persistence currently separates secret-bearing provider headers into private sidecars.  Do not regress this while renaming schemas.

Expected:

```txt
v2 migration must preserve sidecar secret behavior
```

---

# Test plan

## Unit tests to update/delete

Delete or rewrite tests asserting:

```txt
continuityContext is passed through
transcript replay populates conversationMessages for normal resume/fallback
threadInstructionsFingerprint refreshes ordinary resumed threads
provider-state.ts owns independent normalization
```

Update tests that construct `AssistantRouteTurnPlan` and currently include `continuityContext`, `threadInstructionsFingerprint`, or provider-generic names. Existing provider final coverage tests construct route plans with `continuityContext: null` and `threadInstructionsFingerprint`. 

## New unit tests

Add tests for:

```txt
v1 resumeState parses into v2 codexResume
resume state without threadId normalizes to null
route mismatch prevents resume
target/model/sandbox/profile/codexHome/codexCommand changes prevent resume
ordinary resume sends no developerInstructions
fresh thread sends developer/bootstrap instructions
transcripts are not replayed when codexResume is missing
failure-time recovered codexThreadId is not persisted
fresh fallback codexThreadId persists only after successful finalization
```

## Integration tests

Add/keep:

```txt
manual message, first turn:
  creates conversation binding and codexResume after success

manual message, second turn:
  passes resumeCodexThreadId to Codex and no conversationMessages replay

target update:
  clears codexResume

resume stale:
  starts fresh thread and persists new codexResume after success

provider failure:
  leaves existing codexResume unchanged

active-turn continuation:
  accepted-turn refs still materialize transcript coordinates

hosted checkpoint:
  fails or clears pointer if Codex rollout file missing
```

## Migration tests

Fixture:

```json
{
  "schema": "murph.assistant-session.v1",
  "sessionId": "asst_old",
  "target": { "adapter": "codex-cli" },
  "resumeState": {
    "providerSessionId": "codex-thread-old",
    "resumeRouteId": "route-old",
    "codexRolloutRelativePath": "sessions/2026/05/01/rollout-2026-05-01T...jsonl",
    "threadInstructionsFingerprint": "thread-instructions-v1:..."
  }
}
```

Expected v2:

```json
{
  "schema": "murph.assistant-conversation.v2",
  "conversationId": "asst_old",
  "codexResume": {
    "threadId": "codex-thread-old",
    "routeFingerprint": "route-old",
    "rolloutRelativePath": "sessions/2026/05/01/rollout-2026-05-01T...jsonl"
  }
}
```

`threadInstructionsFingerprint` should not survive as hot-path resume state.

---

# Concrete PR order

## PR 1: dead continuity cleanup

Scope:

```txt
- Remove AssistantExecutionPlan.resumeState.
- Remove continuityContext everywhere.
- Delete stale service-contract provider planning types if unused.
- Update tests that build route plans.
```

Risk: low.

## PR 2: Codex resume-state owner

Scope:

```txt
- Add codex-resume-state owner.
- Move normalization/schema helpers into one place.
- Replace provider-state helper calls.
- Keep v1 JSON compatibility.
- Rename internal values to codexThreadId / routeFingerprint.
```

Risk: medium, mostly naming and schema compatibility.

## PR 3: transcript replay hard cut

Scope:

```txt
- Remove durable transcript replay from provider planning.
- Keep transcript append/list/ref APIs.
- Rename replay retention to audit retention or remove replay-specific pruning.
- Ensure old sessions without Codex resume start fresh.
```

Risk: medium product behavior change for old sessions without Codex pointers.

## PR 4: ordinary resume thinning

Scope:

```txt
- On thread/resume, send only threadId + excludeTurns by default.
- Stop computing/storing threadInstructionsFingerprint for ordinary resume.
- Keep full bootstrap instructions for new threads.
- Optional explicit debug/migration hook for instruction refresh.
```

Risk: medium. Verify Codex still applies expected persistent developer instructions from thread bootstrap.

## PR 5: failure/fallback commit safety

Scope:

```txt
- Stop saving recovered providerSessionId on provider failure.
- Keep recovered id only in diagnostics/error context.
- Persist fresh fallback Codex thread only through successful finalization.
```

Risk: medium-high in hosted continuity, but architecturally important.

## PR 6: provider-to-Codex naming hard cut

Scope:

```txt
- Rename internal provider-generic types/modules to Codex-specific names.
- Keep public compatibility shims temporarily.
- Collapse provider registry wrappers after imports settle.
```

Risk: high churn, low semantic risk.

## PR 7: v2 conversation binding store

Scope:

```txt
- Introduce AssistantConversation v2.
- Read v1 sessions as migration input.
- Persist v2 binding + codexResume only.
- Keep sessionId as compatibility alias to conversationId.
- Move indexes toward projection/rebuildable lookup later.
```

Risk: high. Do after the smaller cuts prove the model.

---

# Final keep/remove list

## Remove now

```txt
AssistantExecutionPlan.resumeState
continuityContext
duplicate resume-state normalization
durable transcript replay into model prompts
threadInstructionsFingerprint as ordinary resume state
failure-time persistence of recovered Codex thread ids
provider-generic internals after semantic cleanup
```

## Keep, but rename/narrow

```txt
Murph session metadata -> AssistantConversation / binding metadata
providerSessionId      -> codexThreadId
resumeRouteId          -> routeFingerprint
codexRolloutRelativePath -> keep until hosted checkpointing no longer needs it
transcripts            -> audit/UI/active-turn refs, not continuity
indexes.json           -> eventually projection, not authority
runtime-state-service  -> acceptable short-term facade; narrow after store split
```

## Do not touch for this migration

```txt
outbox
turn receipts
diagnostics
accepted-turn input journals
automation state
binding/delivery logic
hosted app auth sessions
device-sync bearer sessions
browser-vault crypto/session delivery
hosted Codex rollout snapshotting
```

# Final recommendation

Land the cleanup in this order:

```txt
1. Delete dead continuity fields.
2. Centralize Codex resume state.
3. Remove transcript replay as model continuity.
4. Thin ordinary Codex resume.
5. Make failure/fallback pointer persistence commit-safe.
6. Rename provider internals to Codex internals.
7. Convert AssistantSession into AssistantConversation binding metadata.
```

The core rule for every PR:

```txt
A Murph record may point to a Codex thread.
It must never pretend to own that thread’s history.
```

That gives you the clean hard cut without losing the Murph-owned routing, delivery, audit, active-turn, and hosted checkpoint responsibilities that Codex cannot replace.
