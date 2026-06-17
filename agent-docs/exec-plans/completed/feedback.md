Yes — with your simplicity constraint, I would land this as a **migration to better use the existing assistant-runtime issue pipeline**, not as a new feedback system.

The key migration principle:

> **Do not teach Murph to report friction. Teach the runtime to record hard failures it already observes.**

That means no assistant feedback tool, no prompt change, no daily LLM introspection job, no new DB table, no new service, no new queue, and no new user-path model behavior.

## Target end state

The final architecture should be this:

```txt
Codex/app-server action or provider turn fails
  -> assistant-engine builds bounded AssistantRuntimeIssueInput
  -> assistant-engine writes existing pending runtime issue record, best-effort
  -> hosted-runtime exports existing pending issue files after durable workspace work
  -> apps/web imports into existing HostedAssistantRuntimeIssue
  -> daily SQL/admin rollup groups by fingerprint
```

The existing runtime issue record shape is already enough: `component`, `operation`, `phase`, `issueKind`, `severity`, `errorCode`, `fingerprint`, `details`, `surface`, and `environment`. No schema migration is required for v0.

The existing writer already writes pending issue records under the assistant runtime issue directory using `writePendingAssistantRuntimeIssueRecord`.  Hosted export already lists pending issue records, batches them, sends them through `issueExportPort`, and deletes only acknowledged rows.    Web import already parses records, applies 30-day retention, and upserts into `HostedAssistantRuntimeIssue`.

So the migration is mostly about **capturing the right issue inputs at the right boundary**.

---

# Non-goals

Do **not** build these in v0:

1. No `assistant_report_friction` tool.
2. No “call a tool before final reply” pattern.
3. No “after every response, self-review” step.
4. No prompt instruction asking Murph to self-report.
5. No daily Murph/LLM inspection job.
6. No new telemetry service.
7. No new DB table.
8. No raw stdout/stderr storage.
9. No full command string storage.
10. No prompt, transcript, vault content, local path, email, phone, or URL storage.
11. No per-member relation on issue rows.
12. No generalized “feedback” abstraction.

The existing hosted issue table is already anonymized enough for v0: it stores issue metadata and details JSON, has indexes for grouping by fingerprint/severity/kind, and does not include a member relation in the model.

---

# Important correction: do not use `rawToolEvents` for this

There is a tempting path: populate `rawToolEvents` and let `recordAssistantToolFailureRuntimeIssues` consume it.

I would **not** do that.

`rawToolEvents` is also consumed by transcript audit code. Transcript audit turns `assistant.tool.*` events into transcript entries, including failed tool audit text.   That is the wrong place for private runtime issue telemetry, especially command failures.

Instead, add a separate internal provider metadata field:

```ts
runtimeIssueInputs: readonly AssistantRuntimeIssueInput[]
```

This field is not model-visible and not transcript-visible. It is just a list of already-sanitized issue drafts for the runtime issue pipeline.

Current Codex metadata already has `rawToolEvents`, but Codex currently sets it to `[]` in both failure and success paths.   So this is a good chance to avoid reviving the wrong concept.

---

# Migration guide

## Phase 0 — freeze scope

Before code changes, write this into the task/PR description:

```txt
This migration only records automatic, privacy-safe assistant-runtime issues
from already-observed runtime/provider/action failures.

It does not add model-visible feedback tools, prompt self-reporting, raw logs,
a new database table, a new queue, or a daily LLM job.
```

Also decide the v0 capture set:

```txt
v0 captures:
- terminal provider turn failure
- failed Codex command.execution action
- failed Codex dynamic.tool.call action
- failed Codex mcp/tool.call action
- dynamic tool invalid/unsupported/failed result

v0 does not capture:
- subjective "this was annoying"
- successful but long workflows
- raw command contents
- raw command output
- arbitrary model-written explanations
```

That keeps the product useful but intentionally narrow.

---

## Phase 1 — add one internal metadata field

Update:

```txt
packages/assistant-engine/src/assistant/providers/types.ts
```

Add to `AssistantProviderAttemptMetadata`:

```ts
runtimeIssueInputs: readonly AssistantRuntimeIssueInput[]
```

Use the existing `AssistantRuntimeIssueInput` type from `issue-reporting.ts`.

Then update all empty metadata constructors:

```ts
{
  activityLabels: [],
  executedToolCount: 0,
  providerActionCount: 0,
  rawToolEvents: [],
  runtimeIssueInputs: [],
}
```

The `codex-turn-runner` currently initializes metadata with `rawToolEvents: []`; add `runtimeIssueInputs: []` there too.

Do **not** remove `rawToolEvents` in the same first patch unless it is obviously safe. The first migration should be additive at the metadata boundary. Deleting `rawToolEvents` can be a cleanup patch once tests prove no one needs it.

---

## Phase 2 — add one tiny plural recorder

In:

```txt
packages/assistant-engine/src/assistant/issue-reporting.ts
```

Keep the existing `recordAssistantRuntimeIssue`. It already creates a sanitized record and writes to pending issue state.

Add a small plural helper:

```ts
export function recordAssistantRuntimeIssueInputsBestEffort(input: {
  issues: readonly AssistantRuntimeIssueInput[]
  policy: AssistantDiagnosticsPolicy
  vault: string
}): void {
  if (!input.policy.privateIssueCaptureEnabled || input.issues.length === 0) {
    return
  }

  for (const issue of input.issues.slice(0, 8)) {
    void recordAssistantRuntimeIssue({
      issue,
      policy: input.policy,
      vault: input.vault,
    }).catch(() => undefined)
  }
}
```

This helper should deliberately return `void`.

That is the reply-path safety guarantee: issue writes are best-effort and cannot block final user delivery.

Then delete or stop using:

```ts
recordAssistantToolFailureRuntimeIssues(...)
```

after callers are migrated. It currently parses pseudo-events of type `assistant.tool.failed` into issue records.   For the new design, producing `AssistantRuntimeIssueInput` directly is simpler and avoids an extra fake event format.

If deleting the old helper in the same PR causes too much churn, leave it temporarily but remove all production calls. Do not route new issue capture through it.

---

## Phase 3 — collect runtime issue inputs inside Codex app-server execution

Update:

```txt
packages/assistant-engine/src/assistant-codex.ts
```

The correct boundary is `runCodexAppServerTurnOnProcess`. It already has the facts we need: `jsonEvents`, `providerActionCount`, dynamic tool execution, `codexThreadId`, and `turnId`.

Add local state:

```ts
const runtimeIssueInputs: AssistantRuntimeIssueInput[] = []

function pushRuntimeIssueInput(issue: AssistantRuntimeIssueInput): void {
  if (runtimeIssueInputs.length >= 8) {
    return
  }

  runtimeIssueInputs.push(issue)
}
```

Do not create a durable queue. Do not persist anything here. This is just per-turn memory.

Then add `runtimeIssueInputs` to:

```ts
CodexAppServerTurnResult
CodexAppServerTurnFailureContext
```

The failure context already carries `jsonEvents`, `additionalUsages`, `providerActionCount`, `codexThreadId`, and `providerTurnId`; add `runtimeIssueInputs` to the same context.

At successful return, include:

```ts
runtimeIssueInputs
```

next to `jsonEvents` and `providerActionCount`. The turn result already returns those fields.

---

## Phase 4 — capture dynamic tool failures

In `handleAcceptedServerRequest`, dynamic tool requests currently produce failed RPC responses for unsupported tools, invalid args, and caught execution errors.

Add issue inputs in those same branches.

### Unsupported dynamic tool

When `dynamicToolRequest.kind === 'unsupported-dynamic-tool'`, push:

```ts
{
  component: 'assistant.codex-dynamic-tool',
  operation: 'unsupported-dynamic-tool',
  phase: 'tool_call',
  issueKind: 'schema_rejection',
  severity: 'warning',
  errorCode: 'ASSISTANT_DYNAMIC_TOOL_UNSUPPORTED',
  summary: 'Codex requested an unsupported Murph dynamic tool.',
  details: {
    requestKind: 'unsupported-dynamic-tool',
    namespacePresent: dynamicToolRequest.namespace !== null,
    toolPresent: dynamicToolRequest.tool !== null,
  },
}
```

Do not store the raw namespace/tool unless it passes a strict safe identifier check. Even then, optional.

### Invalid dynamic tool arguments

For:

```ts
invalid-generate-image-arguments
invalid-progress-arguments
invalid-response-media-arguments
```

push:

```ts
{
  component: 'assistant.codex-dynamic-tool',
  operation: dynamicToolRequest.kind,
  phase: 'tool_call',
  issueKind: 'schema_rejection',
  severity: 'warning',
  errorCode: 'ASSISTANT_DYNAMIC_TOOL_INVALID_ARGUMENTS',
  summary: 'Codex requested a Murph dynamic tool with invalid arguments.',
  details: {
    requestKind: dynamicToolRequest.kind,
  },
}
```

### Dynamic tool execution catch

Where the code currently catches and returns `"dynamic tool failed"`, push:

```ts
{
  component: 'assistant.codex-dynamic-tool',
  operation: dynamicToolRequest.kind,
  phase: 'tool_call',
  issueKind: 'tool_error',
  severity: 'warning',
  errorCode: 'ASSISTANT_DYNAMIC_TOOL_FAILED',
  summary: 'Murph dynamic tool execution failed.',
  details: {
    requestKind: dynamicToolRequest.kind,
  },
}
```

Do not include the thrown error message in v0. Error messages are often where paths, URLs, or provider details leak.

---

## Phase 5 — capture failed command/action events

Codex action diagnostics already classifies action kinds such as `command.execution`, `dynamic.tool.call`, `mcp.tool.call`, `file.change`, and `web.search`.  It also already counts failed actions.  The failure predicate is already privacy-safe: it looks at normalized exit code, status, success boolean, or exitCode fields.

Do not duplicate the full diagnostics reducer. Add one small pure helper, either inline in `assistant-codex.ts` or next to action diagnostics if reuse is clean:

```ts
function buildRuntimeIssueInputForFailedCodexAction(input: {
  normalizedEvent: CodexNormalizedEvent
  rawEvent: CodexRpcMessage
}): AssistantRuntimeIssueInput | null
```

Start with only `item.completed` / `item.completed`-equivalent events. Skip started events.

For `command.execution` with nonzero exit code:

```ts
{
  component: 'assistant.codex-action',
  operation: 'command.execution',
  phase: 'provider_turn',
  issueKind: 'tool_error',
  severity: 'warning',
  errorCode: 'CODEX_COMMAND_EXIT_NONZERO',
  summary: 'Codex command execution failed during provider turn.',
  details: {
    actionKind: 'command.execution',
    exitCode,
    durationMsBucket,
    outputBytesBucket,
  },
}
```

For failed MCP/tool calls:

```ts
{
  component: 'assistant.codex-action',
  operation: 'mcp.tool.call',
  phase: 'tool_call',
  issueKind: 'tool_error',
  severity: 'warning',
  errorCode: 'CODEX_TOOL_CALL_FAILED',
  summary: 'Codex tool call failed during provider turn.',
  details: {
    actionKind: 'mcp.tool.call',
    durationMsBucket,
    outputBytesBucket,
  },
}
```

For failed dynamic tool call item events:

```ts
{
  component: 'assistant.codex-action',
  operation: 'dynamic.tool.call',
  phase: 'tool_call',
  issueKind: 'tool_error',
  severity: 'warning',
  errorCode: 'CODEX_DYNAMIC_TOOL_CALL_FAILED',
  summary: 'Codex dynamic tool call failed during provider turn.',
  details: {
    actionKind: 'dynamic.tool.call',
    durationMsBucket,
    outputBytesBucket,
  },
}
```

Do **not** include:

```txt
commandLabel
stdout
stderr
aggregatedOutput
formattedOutput
filePaths
query
prompt
arguments
workingDirectory
```

Action diagnostics already measures output bytes without preserving output text, so copy that idea.

### Bucketing helpers

Use coarse buckets:

```ts
function durationMsBucket(value: number | null):
  | 'unknown'
  | 'lt_1s'
  | '1_5s'
  | '5_30s'
  | '30_120s'
  | 'gt_120s'

function bytesBucket(value: number | null):
  | 'unknown'
  | '0'
  | 'lt_1kb'
  | '1_10kb'
  | '10_100kb'
  | 'gt_100kb'
```

This keeps the record useful without high-cardinality telemetry.

---

## Phase 6 — map Codex result/failure context into provider metadata

Update:

```txt
packages/assistant-engine/src/assistant/providers/codex-cli.ts
```

Success path currently creates metadata with `providerActionCount: result.providerActionCount` and `rawToolEvents: []`.  Change it to:

```ts
metadata: {
  activityLabels: [],
  executedToolCount: 0,
  providerActionCount: result.providerActionCount,
  rawToolEvents: [],
  runtimeIssueInputs: result.runtimeIssueInputs,
}
```

Failure path currently gets `failureContext?.jsonEvents`, usage, provider action count, and returns metadata with `rawToolEvents: []`.  Change it to:

```ts
metadata: {
  activityLabels: [],
  executedToolCount: 0,
  providerActionCount: failureContext?.providerActionCount ?? 0,
  rawToolEvents: [],
  runtimeIssueInputs: failureContext?.runtimeIssueInputs ?? [],
}
```

Again: leave `rawToolEvents` empty. Do not use it for private issue reporting.

---

## Phase 7 — write runtime issue inputs best-effort from the turn runner

Update:

```txt
packages/assistant-engine/src/assistant/codex-turn-runner.ts
```

Today, after the provider attempt returns, the turn runner awaits `recordAssistantToolFailureRuntimeIssues(...)`.  Replace that with fire-and-forget recording of the new metadata field:

```ts
recordAssistantRuntimeIssueInputsBestEffort({
  issues: attemptMetadata.runtimeIssueInputs,
  policy: attemptPlan.routePlan.diagnosticsPolicy,
  vault: executionPlan.input.vault,
})
```

Do not `await`.

If the recorder fails, user delivery must continue.

### Terminal provider failure issue

In the catch path, after deriving `errorCode`, also record a terminal provider issue:

```ts
recordAssistantRuntimeIssueInputsBestEffort({
  issues: [
    {
      component: 'assistant.codex-provider',
      operation: attemptPlan.route.provider,
      phase: 'provider_turn',
      issueKind: classifyProviderIssueKind(error),
      severity: 'error',
      errorCode,
      summary: 'Codex provider turn failed.',
      details: {
        providerRequestOutcome:
          failedAttemptOutcome ?? 'failed',
        providerActionCount:
          attemptMetadata.providerActionCount,
        rawEventCountBucket:
          countBucket(failedAttemptRawEvents.length),
      },
    },
  ],
  policy: attemptPlan.routePlan.diagnosticsPolicy,
  vault: executionPlan.input.vault,
})
```

Do not include `errorMessage(error)` in the issue details. The existing attempt observability can keep its local detail if already intended, but the hosted issue sink should stay structured and low-risk.

The catch path already records Codex attempt failure for local observability.  This new issue record is the privacy-safe product/admin aggregate, not a replacement for local debugging.

---

## Phase 8 — keep summary/fingerprint stable

This is important.

`createAssistantRuntimeIssueFingerprint` hashes `component`, `errorCode`, `issueKind`, `operation`, `phase`, and `summary`.  So if the summary includes dynamic text, you will create high-cardinality fingerprints and ruin aggregation.

Bad:

```ts
summary: `Command failed: ${rawCommand}`
```

Good:

```ts
summary: 'Codex command execution failed during provider turn.'
```

Bad:

```ts
summary: `Tool ${toolName} failed because ${error.message}`
```

Good:

```ts
summary: 'Codex tool call failed during provider turn.'
```

Put only safe, bounded enum-ish details into `details`.

Also remember that issue detail values are sanitized and bounded, but that is a last line of defense, not permission to pass raw data. The issue reporter already redacts strings, URLs, paths, emails, and phone-like numbers before writing.

---

## Phase 9 — verify hosted export is actually wired

The export function exists and is tested.  But before assuming production export is happening, grep for:

```txt
exportHostedPendingAssistantRuntimeIssues
```

If it is only referenced by the function and test, wire it once in the hosted runtime.

Preferred location:

```txt
packages/assistant-runtime/src/hosted-runtime.ts
```

Place it **after** successful durable workspace checkpoint / idle shutdown work, not before final delivery. The hosted runtime already has an idle shutdown checkpoint flow that returns invocation status afterward.

Pseudo-shape:

```ts
await checkpointHostedRuntimeDirtyWorkspace(...)

await exportHostedPendingAssistantRuntimeIssues({
  issueExportPort: runnerPlatform.issueExportPort ?? null,
  vaultRoot: restored.vaultRoot,
}).catch((error) => {
  console.warn(`Failed to export hosted assistant runtime issues: ${summarizeHostedExecutionError(error)}`)
})
```

It is acceptable to `await` here because the user-visible response should already be delivered and the workspace should already be durable. If export fails, pending files remain and can be retried later. The exporter already leaves unacknowledged records pending.

Do not add a new retry queue. The pending issue files are the queue.

---

## Phase 10 — do not add a DB migration

No Prisma migration for v0.

Use:

```txt
HostedAssistantRuntimeIssue
```

as-is.

The web importer already upserts by `issueId` and stores the record fields plus `detailsJson`.

Do not fill `releaseSha` / `runtimeName` in v0 unless those values already arrive naturally at this boundary. They are useful, but not required to solve the current problem. The migration should not widen into runtime identity plumbing.

---

# Daily rollup

Start with SQL only.

No LLM. No new service.

```sql
select
  fingerprint,
  component,
  operation,
  phase,
  issue_kind,
  severity,
  error_code,
  count(*) as occurrences,
  min(occurred_at) as first_seen_at,
  max(occurred_at) as last_seen_at,
  jsonb_agg(details_json order by occurred_at desc) -> 0 as latest_details
from hosted_assistant_runtime_issue
where occurred_at >= now() - interval '1 day'
group by
  fingerprint,
  component,
  operation,
  phase,
  issue_kind,
  severity,
  error_code
order by
  occurrences desc,
  max(occurred_at) desc;
```

That gives the team a daily “what is breaking Murph?” view.

Only after this is useful should you add:

```txt
admin dashboard
Slack digest
GitHub issue creation
LLM summary over top clusters
```

Do not build those first.

---

# Data contract v0

Every stored issue should satisfy:

```ts
type V0AssistantRuntimeIssueDetails =
  | {
      actionKind: 'command.execution'
      exitCode: number
      durationMsBucket: string
      outputBytesBucket: string
    }
  | {
      actionKind: 'dynamic.tool.call' | 'mcp.tool.call'
      durationMsBucket: string
      outputBytesBucket: string
      toolName?: string
    }
  | {
      requestKind:
        | 'invalid-generate-image-arguments'
        | 'invalid-progress-arguments'
        | 'invalid-response-media-arguments'
        | 'unsupported-dynamic-tool'
        | 'generate-image'
        | 'send-progress-update'
        | 'attach-response-media'
    }
  | {
      providerRequestOutcome: 'failed' | 'partial' | 'aborted'
      providerActionCount: number
      rawEventCountBucket: string
    }
```

Do not allow arbitrary `message`, `reason`, `stderr`, `stdout`, `command`, `path`, or `prompt` fields in v0 details.

---

# Tests to write

## 1. Issue reporter tests

In:

```txt
packages/assistant-engine/test/assistant-product-small-seams.test.ts
```

or a new targeted test file if that file is too crowded.

Test:

```txt
recordAssistantRuntimeIssueInputsBestEffort:
- writes at most 8 issues
- respects privateIssueCaptureEnabled false
- does not throw if writePendingAssistantRuntimeIssueRecord rejects
- preserves stable operation/component/issueKind fields
- sanitizes unsafe details through existing record path
```

The issue reporter already has mocked `writePendingAssistantRuntimeIssueRecord` available in `assistant-product-small-seams.test.ts`.

## 2. Codex action extraction tests

Add focused unit tests for the pure failed-action issue builder:

```txt
command.execution item.completed with exitCode 1
  -> one issue input

command.execution item.completed with exitCode 0
  -> no issue input

mcp.tool.call item.completed with status failed
  -> one issue input

dynamic.tool.call item.completed with success false
  -> one issue input

failed command with stdout/stderr/commandLabel/filePaths present
  -> issue details do not contain those fields
```

## 3. Codex metadata tests

Test:

```txt
successful Codex turn with failed command action
  -> provider metadata.runtimeIssueInputs contains command issue
  -> rawToolEvents remains []

failed Codex turn with failure context
  -> metadata.runtimeIssueInputs includes failure-context issue inputs
```

## 4. Turn runner best-effort test

Test the user-path guarantee:

```txt
given recordAssistantRuntimeIssue throws or never resolves
when provider turn succeeds
then executeCodexTurnWithRecovery still returns succeeded result
```

This is the most important test for your concern.

## 5. Hosted export tests

Existing hosted export tests already verify that acknowledged issue files are cleared and malformed/forward-versioned files are skipped while valid files export.

Add only one integration test if you wire production export:

```txt
after idle checkpoint, pending issue export is called with restored vault root
```

Do not overbuild.

## 6. Web import tests

Existing web import logic parses runtime issue records and upserts.  Add a single regression test if needed:

```txt
imports command.execution issue details without member relation
```

---

# Rollout plan

## PR 1 — internal capture only

Scope:

```txt
assistant-engine only
```

Changes:

```txt
- add runtimeIssueInputs metadata field
- add best-effort plural issue recorder
- collect dynamic tool failure issue inputs
- collect command/tool action failure issue inputs
- record runtimeIssueInputs fire-and-forget from codex-turn-runner
- record terminal provider failure fire-and-forget
```

No hosted export changes unless export is already wired and tests stay small.

Acceptance:

```txt
- no model-visible tools
- no prompt changes
- no DB migration
- no raw command/output details
- final reply path does not await issue writes
```

## PR 2 — hosted export wiring verification

Scope:

```txt
assistant-runtime only, unless production export is already wired
```

Changes:

```txt
- grep for exportHostedPendingAssistantRuntimeIssues
- if missing from production path, call it after durable idle checkpoint
- keep export failure non-fatal
```

Acceptance:

```txt
- pending issues export after durable work
- export failure leaves pending records
- no new queue/service
```

## PR 3 — SQL/admin rollup

Scope:

```txt
apps/web or ops docs
```

Start with a saved SQL query or tiny internal route. Do not build a new dashboard until the query proves useful.

Acceptance:

```txt
- top issue fingerprints over last 24h visible
- grouped by component/operation/issueKind/severity
- no member-level drilldown
```

## PR 4 — cleanup

After PR 1 is green and no production code depends on the old pseudo-event path:

```txt
- delete recordAssistantToolFailureRuntimeIssues if unused
- delete pseudo assistant.tool.failed issue parsing if unused
- optionally remove rawToolEvents from provider metadata if all callers are dead
```

Do not do this cleanup before the main migration is verified.

---

# Verification commands

Use scoped verification, not full workspace heroics unless the repo expects it.

Suggested:

```bash
pnpm --dir packages/assistant-engine typecheck
pnpm --dir packages/assistant-engine test -- --run test/assistant-product-small-seams.test.ts
pnpm --dir packages/assistant-engine test -- --run test/assistant-codex-final-coverage.test.ts
pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-issues.test.ts --config vitest.config.ts --no-coverage
pnpm --dir ../.. exec vitest run apps/web/test/hosted-execution-runtime-issues.test.ts --project hosted-web-execution --config apps/web/vitest.workspace.ts --no-coverage
git diff --check
```

If one of these fans into an unrelated known failure, record it explicitly and keep the patch scoped.

---

# Rollback plan

Use the existing kill switch first:

```txt
MURPH_ASSISTANT_PRIVATE_ISSUES=0
```

The diagnostics policy already reads `MURPH_ASSISTANT_PRIVATE_ISSUES` and defaults capture to enabled when unset.

Rollback levels:

```txt
Level 1: set MURPH_ASSISTANT_PRIVATE_ISSUES=0
Level 2: revert hosted export wiring
Level 3: revert assistant-engine capture patch
```

No DB rollback should be needed because v0 uses the existing table and retention.

---

# Final checklist

Before merging, this should be true:

```txt
[ ] No assistant_report_friction tool exists.
[ ] No system prompt tells Murph to report friction.
[ ] No model turn needs to call a feedback tool.
[ ] No runtime issue write is awaited on the success reply path.
[ ] No raw stdout/stderr/command/prompt/path/vault content is stored.
[ ] No Prisma migration was added.
[ ] Existing HostedAssistantRuntimeIssue import still works.
[ ] Hosted export is either verified already wired or wired after durable work.
[ ] Daily rollup can group by fingerprint.
[ ] There is a kill switch.
```

The cleanest v0 is therefore:

> **Add one internal `runtimeIssueInputs` metadata path, populate it from Codex/provider failures, record it best-effort through the existing issue writer, and roll it up from the existing hosted issue table.**

That gives you validated, privacy-safe, relevant feedback without making Murph think about reporting, without delaying replies, and without introducing a second diagnostics architecture.
