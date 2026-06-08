# PR 65 Follow-up Migration Guide: Fresh Codex Threads on Assistant Contract Changes

## Executive decision

Build on PR 65 by making this the durable rule:

> A Codex provider thread is born with one stable Murph assistant contract. If that contract changes, Murph starts a new Codex provider thread inside the same Murph session.

Do not mutate old Codex threads. Do not reintroduce `refreshThreadInstructions`. Do not send `developerInstructions` or `dynamicTools` on `thread/resume`. Do not add MCP, a summary service, `thread/inject_items`, or periodic rotation yet.

The first implementation should solve only the real current problem: stable Murph prompt changes and dynamic tool additions must reach the next provider turn without editing Codex.

## Baseline from PR 65

PR 65 is the right deletion baseline:

- `thread/resume` no longer sends `developerInstructions`.
- `thread/resume` no longer sends `dynamicTools`.
- Fresh `thread/start` still sends current `developerInstructions` and `dynamicTools`.
- Tests and diagnostics are being updated to remove `refreshThreadInstructions`.

Keep those deletions. The follow-up should not partially restore resume-refresh behavior.

## Why a fresh Codex thread is the right boundary

Current Codex supports dynamic tools on thread start, not resume. The Codex app-server protocol has `dynamic_tools` on `ThreadStartParams`, but `ThreadResumeParams` has no dynamic tool field. Resumed/forked Codex sessions spawn with an empty dynamic tool list and then fall back to dynamic tools persisted from the original thread state/rollout.

Therefore, an old Codex thread born with tool A cannot be upgraded to tool A + tool B through Murph’s resume request. Without editing Codex or adding another tool layer, a dynamic tool surface change requires a new Codex provider thread.

Prompt-only changes could theoretically use resume instruction overrides if the thread is unloaded, but having two lifecycle paths is unnecessary complexity. Use one rule for both prompt and dynamic tool changes: fresh provider thread.

## What counts as the assistant contract

The assistant contract is the stable thread-start configuration that should remain constant for a Codex provider thread:

```ts
type AssistantCodexContract = {
  routeFingerprint: string
  developerInstructions: string | null
  dynamicTools: readonly unknown[]
}
```

Do not include per-turn data:

- current date / timezone,
- session binding,
- current user message,
- current dynamic turn context,
- recent transcript history,
- onboarding guidance,
- active turn ids,
- provider request ordinal.

Those belong in the current turn prompt, not in the provider-thread contract.

## Recommended state addition

Extend Codex resume state with one optional field:

```ts
assistantContractFingerprint?: string
```

The persisted state becomes:

```ts
type CodexResumeState = {
  threadId: string
  routeFingerprint: string
  rolloutRelativePath?: string | null
  assistantContractFingerprint?: string
}
```

Backward compatibility rule: missing `assistantContractFingerprint` is a mismatch. Existing sessions rotate once after deploy and then persist the new field.

This is intentional. It avoids carrying legacy threads forward forever with old prompt/tool surfaces.

## Fingerprint rule

Compute the fingerprint from the actual thread-start contract:

```ts
const assistantContractFingerprint = sha256Stable({
  routeFingerprint,
  developerInstructions: threadStartDeveloperInstructions,
  dynamicTools: MURPH_DYNAMIC_TOOLS,
})
```

Use stable object-key ordering. Preserve array order for `dynamicTools`, because that is the actual wire contract Codex sees. Do not add a manual epoch.

## Critical stress-test finding: compute from thread-start instructions, not route-plan instructions

After PR 65, `routePlan.developerInstructions` is intentionally `null` on native resume. If the fingerprint is computed from that resume-shaped value, the logic breaks.

The fingerprint must be computed from the developer instructions Murph would send on `thread/start`, even when the current turn may native-resume.

That means route planning should build the thread-start prompt/developer instructions before deciding whether the existing resume state is reusable.

## Route planning algorithm

Replace the current resume-first shape with this sequence:

```ts
const resumeState = readAssistantCodexResume(session)
const resumeBinding = resolveAssistantRouteResumeBinding({
  route,
  sessionResumeState: resumeState,
})

const routeFingerprint = readCodexThreadRouteFingerprint(route)

// Build the fresh thread/start prompt contract regardless of whether we resume.
const threadStartPromptResult = buildRouteSystemPromptResult({
  assistantCliContract: promptProfile === 'conversation'
    ? await readAssistantCliSurfaceBootstrapContext(...)
    : null,
  injectOnboardingGuidance: shouldInjectOnboardingGuidance,
})

const threadStartDeveloperInstructions = normalizeNullableString(
  buildDeveloperInstructions(threadStartPromptResult),
)

const assistantContractFingerprint = buildAssistantCodexContractFingerprint({
  routeFingerprint,
  developerInstructions: threadStartDeveloperInstructions,
  dynamicTools: MURPH_DYNAMIC_TOOLS,
})

const nativeResumeAllowed =
  profile.threadScope === 'session-thread' &&
  routeProviderCapabilities.supportsNativeResume &&
  resumeBinding !== null &&
  resumeBinding.assistantContractFingerprint === assistantContractFingerprint

const resumeCodexThreadId = nativeResumeAllowed
  ? resolveAssistantEffectiveCodexResumeThreadId({
      resumeCodexThreadId: resolveAssistantCodexResumeThreadId({
        resumeState: resumeBinding,
      }),
    })
  : null

const conversationHistoryMessages = resumeCodexThreadId === null
  ? await resolveAssistantCommittedTranscriptHistoryMessages(...)
  : []

const developerInstructions = resumeCodexThreadId === null
  ? threadStartDeveloperInstructions
  : null
```

Notes:

- Build the thread-start developer instructions once and reuse them.
- Native resume gets `developerInstructions: null`.
- Fresh start gets current `developerInstructions` and current `dynamicTools`.
- Do not create a separate planner abstraction unless the inline function becomes demonstrably hard to maintain.

## Fresh-thread fallback after stale resume

Keep stale/corrupt resume fallback. It is still useful recovery.

But simplify it:

- Capture the already-computed `threadStartDeveloperInstructions` and `threadStartPromptResult.layers.dynamicTurnContextPrompt` in the fallback closure.
- Lazily load only `conversationHistoryMessages` when fallback is actually needed.
- Do not rebuild the thread-start prompt inside the fallback. That avoids a race where the fallback uses different instructions from the fingerprint that will be persisted.

Fallback result should still be a fresh `thread/start` with:

- `resumeSessionId: undefined`,
- current `developerInstructions`,
- current dynamic tools via `thread/start`,
- recent transcript history,
- current user prompt.

## Will Codex answer the last 24 messages?

Murph does not send the last 24 transcript messages as separate live Codex turns. It serializes them into the current prompt as a context section before the actual current user message.

Keep this behavior, but make the label less ambiguous:

```diff
- Recent conversation history:
+ Recent conversation history for context only; do not answer these prior messages:
```

The prompt then remains clearly shaped as:

```md
Recent conversation history for context only; do not answer these prior messages:
User:
...

Assistant:
...

User message:
<current user request>
```

This is enough for now. Do not add summaries yet.

## Do not add summaries in this migration

A summary handoff sounds useful, but it adds new failure modes:

- summarization can fail,
- summary generation can slow or block the user turn,
- summaries can drift,
- old prompt/tool assumptions can leak into the summary,
- you need persistence, invalidation, trust semantics, and tests.

Use the existing recent transcript window first. Add one summary field only after a measured product failure proves the transcript window is insufficient.

## Do not add periodic rotation in this migration

The desire to start new provider threads “every once in a while” is reasonable, but not needed to solve the current prompt/tool problem.

Do not add `turnCount >= N`, `compactionCount >= N`, or age-based rotation yet. Those are separate product policies and can create surprising context loss. First ship contract-change rotation only.

A later rotation policy should require a concrete bug, measured memory/context issue, or user-visible quality failure.

## Files to change on top of PR 65

### `packages/operator-config/src/assistant/codex-resume-state.ts`

Add optional `assistantContractFingerprint` to `codexResumeStateSchema`.

Update:

- `normalizeCodexResumeState`,
- `buildCodexResumeState`,
- exported `CodexResumeState` type.

Keep older state valid. Missing fingerprint means the planner will start fresh once.

### `packages/assistant-engine/src/assistant/codex-turn/planning.ts`

Add `assistantContractFingerprint` to `AssistantRouteTurnPlan`.

Compute thread-start developer instructions before final resume decision.

Change resume decision to require both:

- route binding matches,
- assistant contract fingerprint matches.

Return:

```ts
assistantContractFingerprint,
resumeCodexThreadId,
developerInstructions: resumeCodexThreadId === null
  ? threadStartDeveloperInstructions
  : null,
conversationHistoryMessages: resumeCodexThreadId === null
  ? recentHistory
  : undefined,
```

### `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`

Keep `MURPH_DYNAMIC_TOOLS` as the single source of truth for the dynamic tool list.

Do not duplicate tool specs in the fingerprint helper.

### New small helper, preferably in assistant-engine

Example:

```ts
export function buildAssistantCodexContractFingerprint(input: {
  routeFingerprint: string
  developerInstructions: string | null
  dynamicTools: readonly unknown[]
}): string
```

Place it near route planning or Codex thread route helpers. Do not put it in operator-config unless needed; operator-config should only validate/persist the opaque fingerprint.

### `packages/assistant-engine/src/assistant/turn-finalizer.ts`

Persist `assistantContractFingerprint` into resume state when `providerResumeStateAction === 'persist-from-provider-turn'`.

You will need to pass the fingerprint into `resolveAssistantResumeStateFromProviderTurn` / `buildCodexResumeState`.

### `packages/assistant-engine/src/assistant/service-contracts.ts`

Add `assistantContractFingerprint: string` to `ExecutedAssistantProviderTurnResult`, or another already-local structure that reaches the finalizer.

Keep it out of provider-level result types if possible. It is Murph routing state, not Codex provider output.

### `packages/assistant-engine/src/assistant/codex-turn-runner.ts`

When building the successful `ExecutedAssistantProviderTurnResult`, copy:

```ts
assistantContractFingerprint: attemptPlan.routePlan.assistantContractFingerprint
```

### `packages/assistant-engine/src/assistant/providers/helpers.ts`

Change only the recent history label:

```diff
- Recent conversation history:
+ Recent conversation history for context only; do not answer these prior messages:
```

Do not introduce a new history format.

## Things to delete or avoid

Do not re-add:

- `refreshThreadInstructions`,
- `developerInstructions` on `thread/resume`,
- `dynamicTools` on `thread/resume`,
- prompt-refresh diagnostics for resume,
- stale prompt migration paths.

Do not add:

- MCP,
- Codex patches,
- `thread/inject_items`,
- summary storage,
- periodic rotation,
- manual epochs,
- separate prompt contract services.

## Edge cases and expected behavior

### Existing sessions after deploy

Existing resume states have no `assistantContractFingerprint`, so the next turn starts a fresh Codex provider thread. The same Murph session continues. The new provider thread receives recent transcript context and current user prompt.

### Prompt text changes

Stable developer instructions change the fingerprint. Next turn starts a fresh Codex provider thread.

### Dynamic tool additions or description/schema changes

`MURPH_DYNAMIC_TOOLS` changes the fingerprint. Next turn starts a fresh Codex provider thread with the full current dynamic tool set.

### Dynamic turn context changes

No new provider thread. The current turn prompt carries dynamic context.

### Route/model/provider/sandbox changes

Existing `routeFingerprint` behavior still handles this. Including `routeFingerprint` in the contract fingerprint is redundant but makes the contract hash self-contained.

### Native resume stale/corrupt

Same as today: try native resume when route + contract match; if Codex says stale, fallback to fresh thread. Persist the current assistant contract fingerprint with the fallback thread.

### Active turn during deploy

Do not interrupt. Contract selection happens at provider-attempt planning. A running provider turn finishes under the old contract; the next provider attempt uses the new contract if the fingerprint changed.

### Temporal/manual-ai-gated changes

Keep separate. The new replay patch marker and `manual-ai-gated` source should not affect this migration. Assistant contract rotation only chooses provider thread start vs resume; it must not change demand-read, direct-processing, or signal-source semantics.

## Tests to add or update

### 1. Same contract native-resumes

Given a stored resume state with matching route fingerprint and matching assistant contract fingerprint:

- `resumeCodexThreadId` is present,
- `developerInstructions` is `null`,
- `conversationHistoryMessages` is omitted,
- app-server `thread/resume` sends only `threadId` and `excludeTurns`.

### 2. Missing fingerprint starts fresh once

Given a legacy resume state with `threadId` and `routeFingerprint` but no `assistantContractFingerprint`:

- planner sets `resumeCodexThreadId` to `null`,
- fresh thread prompt includes recent transcript context,
- finalizer persists the current fingerprint after success.

### 3. Stable prompt change starts fresh

Given same route but different developer instructions:

- fingerprint differs,
- planner starts fresh,
- fresh `thread/start` receives new `developerInstructions`.

### 4. Dynamic tool addition starts fresh

Given old stored fingerprint for `[send_progress_update]` and current tools `[send_progress_update, attach_response_media]`:

- fingerprint differs,
- planner starts fresh,
- app-server `thread/start` includes both dynamic tools.

### 5. Dynamic turn context does not rotate

Changing current date, channel context, or session binding should not affect the assistant contract fingerprint.

### 6. Stale resume fallback persists fingerprint

When same-contract native resume fails with stale/corrupt state and fallback starts a fresh thread:

- fallback uses the already-computed thread-start developer instructions,
- finalizer persists the current assistant contract fingerprint.

### 7. Recent history label is unambiguous

Provider prompt contains:

```md
Recent conversation history for context only; do not answer these prior messages:
```

and then the actual current turn under:

```md
User message:
```

## Verification commands

Run the PR 65 focused set plus new tests:

```bash
pnpm --dir packages/assistant-engine test -- \
  test/assistant-codex-runtime.test.ts \
  test/codex-thread-instructions.test.ts \
  test/assistant-protocol-index-planning.test.ts \
  test/codex-runtime-helpers.test.ts \
  test/assistant-codex-final-coverage.test.ts

pnpm --dir packages/assistant-runtime test -- test/hosted-runtime-events.test.ts
pnpm --dir packages/cli test -- packages/cli/test/assistant-codex.test.ts
pnpm typecheck
```

Then run the repo’s diff test lane for touched files.

## Final architecture

The long-term model becomes:

```ts
if (!resumeState) {
  threadStart()
} else if (!routeMatches) {
  threadStart()
} else if (!assistantContractMatches) {
  threadStart()
} else {
  threadResume()
}
```

Where:

```ts
assistantContract = routeFingerprint + threadStartDeveloperInstructions + MURPH_DYNAMIC_TOOLS
```

This keeps the system simple:

- Codex owns provider thread state.
- Murph owns the user-facing session and transcript.
- `thread/start` is the only place Murph provides stable instructions and dynamic tools.
- `thread/resume` is a pure provider-state optimization.
- Recent transcript is the only continuity handoff for fresh provider threads.

That is the smallest maintainable architecture that solves the current prompt/tool-update problem without adding another layer.
