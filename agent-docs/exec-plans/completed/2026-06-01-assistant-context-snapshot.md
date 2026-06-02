# Assistant Context Snapshot

## Status

Implementation in progress. The high-level shape is accepted.

Five review lanes checked this plan before this revision:

- assistant route planning and provider fallback
- hosted foreground/background concurrency
- runtime-state placement, hosted portability, and privacy
- query/projection data sources
- tests, observability, and failure modes

The main simplification from that review is: do not make the foreground path
prepare anything. Foreground turns only read the last completed prompt snapshot.
Dirtying is persisted cheaply. Refresh happens later in existing idle/background
runtime work and must be checkpointed when it writes.

Current implementation note: audit-ledger writes are explicitly excluded by the
snapshot dirty-domain classifier. They can still affect the general query
projection, but they do not dirty or rebuild this assistant prompt snapshot.

## Goal

Give the assistant a small, useful orientation hint about the vault without ever
making an assistant turn wait for that hint to become fresh.

The useful v1 orientation is intentionally narrow:

- Active experiments exist, with compact labels and run-plan fields.
- Blood test records are present.
- Saved health context exists, such as goals, conditions, allergies, and
  regimens.

This context may be stale. It is a prompt hint, not evidence. Exact answers
still come from canonical reads and CLI/query tools when the assistant needs
current facts.

Success criteria:

- Route planning, provider execution, retry, and fresh-thread fallback read at
  most one small JSON file for broad orientation.
- A missing, corrupt, stale, or dirty snapshot never blocks an assistant turn.
- Dirty/stale snapshots still inject the last completed prompt block when
  sensitivity policy allows it.
- Relevant canonical writes persist dirty metadata before returning, but do not
  start snapshot building from the write hook.
- Snapshot refresh never uses query projection, full vault hydration, or
  full-read-model construction.
- Hosted refresh writes mark runtime state dirty or return a checkpoint reason,
  so the new snapshot is durable only through the normal hosted checkpoint path.
- Hosted foreground or post-checkpoint work preserves an immediate assistant
  wake while snapshot dirty state remains pending, so a consumed dirty wake is
  re-armed until refresh actually clears it.
- Audit-only, mailbox-only, diagnostics-only, runtime-only, raw-only, research,
  derived inbox, and journal changes do not dirty this snapshot in v1.

## Non-Goals

- Do not make prompt context atomically fresh.
- Do not replace `query.sqlite`, lexical search, metric reads, or exact vault
  queries.
- Do not create product truth under assistant runtime state.
- Do not add a queue, scheduler, worker, Durable Object path, or new
  orchestration framework.
- Do not split "full" and "compact" context.
- Do not keep separate live prompt builders for vault overview or active
  experiment context.
- Do not treat checkpoint/post-checkpoint hooks as the primary refresh trigger.

## Codebase Assessment

Current synchronous path:

- `packages/query/src/vault-reader.ts` makes `readVault()` call
  `loadProjectedVaultSource()`.
- `packages/query/src/query-projection.ts` makes `loadProjectedVaultSource()`
  call `ensureFreshQueryProjection()`.
- `ensureFreshQueryProjection()` scans the canonical query manifest and awaits a
  projection rebuild when stale.
- `packages/contracts/src/vault-families.ts` includes `audit/` in
  `VAULT_QUERY_SOURCE.jsonlRoots`, so operational audit appends can stale the
  general query projection even though audit changes are not useful prompt
  snapshot input.
- `packages/query/src/projection/rebuild.ts` rebuilds query entities, metric
  points, wearable summary rows, and search documents. The expensive work is the
  read-model, wearable dataset, wearable summary, metric, and projection work.

Current prompt context path:

- `packages/assistant-engine/src/assistant/vault-overview.ts` calls
  `readVault()`, `listBloodTests()`, and
  `summarizeWearableSourceHealthRuntime()`. These can force query projection
  freshness.
- `packages/assistant-engine/src/assistant/active-experiment-context.ts` calls
  `readVault()` and then filters active experiment records.
- `packages/assistant-engine/src/assistant/codex-turn/planning.ts` prepares vault
  overview and active experiment context during route planning.
- Provider stale/invalid native-resume fallback is also foreground work. It must
  not call live broad context builders either.

Hosted runtime seams:

- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts` already
  has a hosted canonical write port and runtime dirty/checkpoint machinery.
- Foreground conversation input has priority over background maintenance.
- Background work must yield, abort, or reschedule when fresh foreground input
  arrives.
- A hosted refresh write only survives container restart after it is included in
  a hosted workspace checkpoint.

## Final Shape

One prompt-only assistant runtime file per vault:

```text
.runtime/operations/assistant/context-snapshot.json
```

This file is high-sensitivity assistant runtime residue. It should travel in
encrypted hosted workspace snapshots because it is needed for assistant
continuity, but it must not become a product surface, browser-vault export,
status payload, or query API.

Use the existing versioned JSON envelope style:

```json
{
  "schema": "murph.assistant-context-snapshot",
  "schemaVersion": 1,
  "value": {
    "lastCompleted": {
      "generatedAt": "ISO timestamp",
      "includedDomains": ["experiments", "blood_tests", "health_context"],
      "promptBlock": "rendered prompt text",
      "sectionPresence": {
        "activeExperiments": true,
        "bloodTests": true,
        "healthContext": true
      }
    },
    "pendingDirtyDomains": [],
    "lastRefreshAttempt": {
      "attemptedAt": "ISO timestamp",
      "errorCode": null,
      "status": "succeeded"
    }
  }
}
```

Keep only one prompt content field: `lastCompleted.promptBlock`. Do not store
both raw section strings and a rendered prompt. Store metadata such as section
presence, byte length, dirty domains, and refresh status separately.

The runtime-state descriptor, if added, is for classification and audit clarity.
Hosted inclusion is already broad for portable assistant runtime descendants;
do not add descriptor-driven hosted inclusion machinery.

## Foreground Rule

Foreground means route planning, provider execution, provider retry, and
fresh-thread fallback.

Foreground may only:

1. Read `context-snapshot.json`.
2. Parse the versioned envelope.
3. Return `lastCompleted.promptBlock` when the schema is valid, the prompt block
   is non-empty, and `allowSensitiveHealthContext` permits injection.
4. Return `null` for missing, corrupt, schema-invalid, empty, or
   sensitivity-denied snapshots.

Dirty metadata is scheduling-only. A valid dirty or stale snapshot still injects
the last completed prompt block when sensitivity policy allows it.

Foreground must not:

- Scan canonical source roots for freshness.
- Call `readVault()`, `readVaultTolerant()`, or `readVaultRawTolerant()`.
- Call `readVaultSourceStrict()`, `readVaultSourceTolerant()`,
  `loadProjectedVaultSource()`, or `loadProjectedVaultSourceTolerant()`.
- Call `collectCanonicalEntities()`, `createVaultReadModel()`, or any full
  read-model construction path.
- Call any helper that imports or reaches `query-projection.ts`.
- Call `summarizeWearableSourceHealthRuntime()` or any runtime wearable summary
  helper that can force projection freshness.
- Generate CLI bootstrap context dynamically.
- Await snapshot refresh, checkpoint, browser vault refresh, device sync,
  mailbox projection, or inbox projection work.

Prompt construction should collapse the old inputs into one value:

```ts
assistantContextSnapshotPrompt: string | null
```

Delete the separate live prompt inputs for `vaultOverview` and
`activeExperimentContext`. The active experiment block becomes one section
inside the snapshot prompt, not a separate route-planning helper.

CLI contract handling is separate from this snapshot. The same hot-path rule
applies: foreground may use prebuilt or already persisted CLI contract text, but
must not run dynamic CLI contract generation.

## Dirty Rule

Persist dirty metadata before returning from a relevant canonical write. Dirty
metadata must preserve the last completed prompt block.

The dirty operation is the only write-path work:

```text
markAssistantContextSnapshotDirty(vaultRoot, domains)
```

It should atomically merge `pendingDirtyDomains` into
`context-snapshot.json`. It should not build the snapshot.

Use an independent classifier for snapshot domains. Do not reuse
`VAULT_QUERY_SOURCE` or `isCanonicalQuerySourcePath`, because audit is a query
source but should not dirty this prompt snapshot.

Initial v1 domains:

- `experiments`
- `blood_tests`
- `health_context`

Classification guidance:

- `bank/experiments/**` marks `experiments`.
- `bank/goals/**`, `bank/conditions/**`, `bank/allergies/**`, and
  `bank/regimens/**` mark `health_context`.
- Event-ledger appends mark `blood_tests` in v1 because the builder only checks
  bounded blood-test presence.
- Metric-sample and wearable-only writes do not dirty this snapshot until a
  narrow bounded wearable reader exists.
- `audit/**`, mailbox import, `.runtime/**`, `raw/**`, `research/**`,
  `derived/inbox/**`, `journal/**`, browser-vault replica writes, query
  projection rebuilds, diagnostics, transcripts, receipts, outbox, provider
  cleanup, and status writes do not dirty this snapshot in v1.

If the receipt has path/action data, classify from that data. If path/action
data is genuinely unavailable, mark the included domains dirty as a
low-priority fallback rather than inventing a new inspection pass.

No in-memory dirty set is authoritative. A module-local single-flight flag may
dedupe concurrent refresh attempts, but persisted `pendingDirtyDomains` is the
source of truth.

## Refresh Rule

Refresh is background runtime work, not write-hook work.

Canonical write hook:

- Persist dirty metadata.
- Mark runtime state dirty when the dirty metadata changed.
- Optionally schedule a normal hosted/local wake hint.
- Do not call the builder.

Refresh runner:

- Runs only from existing idle/background runtime work after foreground mailbox
  import has confirmed no conversation work is pending, or from local dev
  maintenance with the same foreground-priority rule.
- Accepts explicit cancellation inputs: `AbortSignal`, hosted
  `runtimeWakeSignal` when available, and `shouldYield`.
- Checks cancellation before and after each section.
- Uses section-level time, file, and byte caps.
- Returns deferred statuses such as `deferred_runtime_wake`,
  `deferred_timeout`, and `deferred_aborted` without clearing dirty domains.
- Writes the completed snapshot atomically only when it can also mark runtime
  state dirty or return a checkpoint reason so hosted checkpointing persists the
  result.

Post-checkpoint hooks may mark dirty or schedule a wake. They must not write the
final snapshot unless another checkpoint is guaranteed.

Local fire-and-forget helpers are allowed only as scheduling helpers, not as the
hosted durability model. If used, they must be macrotask scheduled, do no
meaningful synchronous work before their first await, use explicit inputs
instead of ambient cwd/env assumptions, and attach `.catch` metadata-only
logging.

If a refresh is running and another dirty mark arrives:

- Do not start unbounded parallel work.
- Let the running refresh finish or defer.
- Re-read persisted `pendingDirtyDomains` once before exit if a cheap follow-up
  pass is useful.

If foreground input arrives:

- Abort or defer refresh.
- Keep the previous `lastCompleted.promptBlock`.
- Keep `pendingDirtyDomains`.
- Let the assistant reply.

## Snapshot Builder

The builder must avoid the full query projection and full vault hydration.

Disallowed builder sources:

- `readVault()`, `readVaultTolerant()`, `readVaultRawTolerant()`
- `readVaultSourceStrict()`, `readVaultSourceTolerant()`
- `loadProjectedVaultSource()`, `loadProjectedVaultSourceTolerant()`
- `ensureFreshQueryProjection()`
- `collectCanonicalEntities()`
- `createVaultReadModel()`
- `summarizeWearableSourceHealthRuntime()`
- full `ledger/events/**` scans
- `ledger/samples/**`
- `raw/**`, including `raw/integrations/**`
- `research/**`
- `derived/inbox/**`
- `journal/**`
- `audit/**`

Allowed v1 sources:

- Direct bounded frontmatter scan of `bank/experiments/**` for active
  experiments.
- Direct bounded scans of `bank/goals/**`, `bank/conditions/**`,
  `bank/allergies/**`, and `bank/regimens/**` for saved health context
  presence.
- A bounded newest-shard scan over `ledger/events/**` only for blood-test
  presence, using the existing blood-test event semantics. If the cap is hit,
  reuse the previous blood-test presence or omit the section.
- Wearable coverage is omitted until a narrow provider-coverage reader exists.
  If a reader is added, it may scan only selected canonical event or
  display-grade metric-sample ledgers with strict caps and public-provider
  normalization. It must not rebuild wearable source health, scan
  `ledger/samples/**`, or scan raw provider snapshots.

There is no `vault_coverage` domain in v1. Do not recreate the old broad
overview by scanning raw meals, research notes, inbox roots, automations,
journals, or generic event history.

Package boundary:

- Add one narrow query-owned source-reader surface if the readers belong in
  query, for example `@murphai/query/assistant-context-sources`.
- That surface should export only bounded direct readers and prompt render
  helpers needed by this snapshot.
- Add a guard/test that the surface does not import `query-projection.ts`,
  `vault-reader.ts`, full vault-source hydration, or full read-model
  construction.

## Privacy And Observability

The snapshot can contain sensitive health context. Treat it as high-sensitivity
assistant runtime data.

Never include `promptBlock`, raw section text, raw JSON, raw parse errors,
absolute paths, local identifiers, emails, tokens, secrets, lab text, wearable
values, or health details in:

- hosted runtime logs
- hosted runtime status
- assistant status
- assistant doctor output
- diagnostics snapshots
- checkpoint diagnostics
- browser-vault exports
- tests, fixtures, or docs examples

Allowed telemetry is metadata only:

- `context_snapshot_read` status enum
- elapsed ms
- dirty domain names/counts
- stale/dirty booleans
- section presence booleans
- prompt byte length
- schema/version
- refresh status enum
- redacted failure code

Do not log raw `error.message` from snapshot parsing because it may include file
content or paths. Convert failures to fixed codes such as `missing`,
`invalid_json`, `schema_invalid`, `sensitivity_denied`, or `read_failed`.

## Edge Cases

Missing snapshot:

- Foreground injects nothing.
- Background/idle skips it until a relevant canonical write creates dirty
  metadata.

Corrupt or schema-invalid snapshot:

- Foreground injects nothing and does not throw.
- Logs only a fixed metadata failure code.
- Background refresh can replace it atomically.

Dirty or stale snapshot:

- Foreground still injects the last completed prompt block when sensitivity
  allows it.
- Dirty metadata remains until refresh completes and checkpoints.

Sensitive context disabled:

- Foreground injects nothing.
- Do not build a second non-sensitive snapshot unless a real caller needs it.

Crash after dirty mark:

- Persisted `pendingDirtyDomains` survives if the dirty metadata checkpoint
  completed.
- If the process dies before checkpoint, hosted behavior is no worse than other
  dirty runtime residue since the last accepted checkpoint.

Crash during refresh:

- Atomic write preserves the previous snapshot.
- Dirty domains remain unless a completed refresh clears and checkpoints them.

Continuous user messages:

- Refresh may stay deferred.
- Replies continue using old context or no context.

Query projection stale or absent:

- Prompt context still reads from the snapshot.
- Exact user questions can still call CLI/query tools and pay query cost only
  when current evidence matters.

Container restart:

- Last checkpointed `context-snapshot.json` restores with the workspace.
- Any warm-local refresh result not checkpointed can be lost, which is why
  hosted refresh writes must mark runtime state dirty or return a checkpoint
  reason.

Immediate user asks about a just-written experiment:

- The broad snapshot may be stale.
- The assistant should query the exact canonical experiment when current details
  matter.

## Implementation Order

1. Add the versioned snapshot store under the assistant owner package.
2. Add bounded source readers/rendering, preferably behind a narrow safe
   query-owned subpath if query owns the domain parsing.
3. Replace separate `vaultOverview` and `activeExperimentContext` prompt inputs
   with `assistantContextSnapshotPrompt`.
4. Change route planning and provider fallback to read only the last completed
   snapshot prompt for broad orientation.
5. Ensure foreground CLI contract handling uses only prebuilt or already
   persisted contract text, never dynamic generation.
6. Add the dirty-domain classifier from canonical write receipts and persist
   `pendingDirtyDomains` without building.
7. Add the hosted/local idle refresh runner with cancellation and checkpoint
   integration.
8. Add focused tests and hosted-local proof.

## Acceptance Proof

Route/provider hot path:

- Fresh/bootstrap and resumed route planning with
  `allowSensitiveHealthContext: true` inject a prepared snapshot and do not call
  `readVault()`, vault overview, active experiment live context, query
  projection, wearable runtime summarizers, or dynamic CLI contract generation.
- Provider stale/invalid native-resume fallback uses the same last completed
  snapshot and does not call live broad context builders.
- A dirty snapshot still injects its last completed prompt block.
- Missing, corrupt, schema-invalid, empty, or sensitivity-denied snapshots return
  `null` without throwing.

Dirty and refresh behavior:

- Dirty marking atomically preserves `lastCompleted.promptBlock` and merges
  `pendingDirtyDomains`.
- Audit, mailbox, runtime, raw, research, derived inbox, and journal changes do
  not dirty the snapshot.
- Domain classifier maps experiment, blood-test, and health-context
  write receipts to only the relevant domains.
- A refresh promise that never resolves cannot block route planning or provider
  execution.
- Startup/idle refresh yields or aborts when foreground input appears.
- A refresh-only hosted run marks runtime state dirty, checkpoints, restores,
  and can read the new `context-snapshot.json`.

Builder/source safety:

- The snapshot source-reader surface does not import `query-projection.ts`,
  `vault-reader.ts`, full vault-source hydration, or full read-model
  construction.
- Builder caps cause reuse/omit, not foreground blocking or full scans.
- Wearable v1 omits or reuses previous coverage unless a bounded provider
  coverage reader is present.

Privacy/observability:

- Missing, invalid JSON, schema-invalid JSON, unknown status/domain values, and
  sensitive-looking prompt text do not leak prompt content, raw JSON, raw error
  messages, paths, tokens, emails, or health text in logs/status/diagnostics.
- Positive `context_snapshot_read` telemetry records only fixed status, elapsed
  ms, dirty/stale booleans, section presence, schema/version, and byte length.
- Hosted-local proof shows successful foreground turns have no route-planning
  vault overview, active experiment, `memory_overview`, or query projection
  rebuild work.

## Wearable Coverage

Wearable provider/source coverage is intentionally omitted in v1. Add it only
when there is a narrow bounded reader that does not scan raw provider payloads,
metric samples, full event history, wearable source-health summaries, or query
projection.
Status: completed
Updated: 2026-06-01
Completed: 2026-06-01
