# Hosted Codex Operator Memory

## Goal

Enable Codex-native memories for hosted Murph runs as an operator-memory system that improves future hosted Codex work without replacing Murph's canonical user memory.

Success means:

- Hosted Codex can read useful operator memory on future turns.
- Hosted Codex can first read manually seeded or previously generated operator memory without changing hosted checkpoint behavior.
- Hosted Codex generation stays disabled for production health-user traffic until a Murph-specific extraction contract, privacy lifecycle, and maintenance path are proven.
- Memory generation is bounded by explicit cost, latency, storage, and privacy controls.
- Codex memory remains separate from Murph product memory and cannot become the source of truth for user-facing health/profile facts.
- Container teardown and restore preserve the Codex memory state needed for future use and incremental generation.

## Terms

`Codex resume continuity` means preserving enough Codex local state for `thread/resume` to continue a live provider session.

`Codex operator memory` means Codex's file-backed and state-DB-backed memory system under hosted `CODEX_HOME`, used to remember agent/operator context such as repo conventions, commands, verification habits, operator working preferences, and prior implementation decisions.

`Murph canonical memory` means user-facing durable product memory stored through Murph's own memory surfaces and subject to Murph edit, delete, audit, and consent semantics.

## Non-Goals

- Do not replace Murph canonical memory.
- Do not store health/profile/product truth only in Codex memory.
- Do not expose Codex memory contents in logs, diagnostics, snapshots, analytics, or generated docs.
- Do not persist all of hosted Codex home.
- Do not preserve Codex auth, credentials, logs, caches, prompt-entry history, temp files, sockets, pids, or lock files.
- Do not depend on user-message startup alone for memory generation.
- Do not enable unlimited background extraction or consolidation.
- Do not make Codex memory a hidden second product memory system.
- Do not make ordinary hot checkpoints carry broad Codex memory state.
- Do not treat the existing Codex `UpdateMemories` operation as a completion signal.
- Do not enable Codex memory generation on production user-facing Murph conversations with the default upstream Codex memory write prompts.
- Do not allow hosted read mode to satisfy user-facing "remember" requests by writing Codex memory extension notes.

## Codex Source Findings

Codex memories are behind the experimental `memories` feature flag. Without `[features].memories = true`, the `[memories]` settings do not activate the memory pipeline.

Codex has separate read and write paths:

- `use_memories = true` injects memory read-path developer instructions when `CODEX_HOME/memories/memory_summary.md` exists.
- `generate_memories = true` lets newly created threads be eligible for memory extraction and consolidation.

Codex starts the memory pipeline on root session startup or resume, but skips ephemeral sessions, disabled memory feature flags, and subagents.

Codex startup memory generation:

- scans old threads from the local state DB,
- excludes the current thread,
- only claims threads with `memory_mode = "enabled"`,
- only claims active, non-archived threads,
- only claims threads whose `updated_at` is newer than `max_rollout_age_days`,
- only claims threads whose `updated_at` is older than `min_rollout_idle_hours`,
- skips threads whose latest stage-1 output or success watermark is already at least as new as the thread `updated_at`,
- processes at most `max_rollouts_per_startup` threads per startup.

This means ordinary hosted wake-on-message is not sufficient for reliable generation when Murph usually resumes the same Codex thread. That current thread is excluded from the startup scan. A separate maintenance session is needed so previously active user threads can be processed after they become idle.

`disable_on_external_context = true` marks the whole thread `memory_mode = "polluted"` after web search, MCP, or tool-search external context appears. Polluted threads are excluded from extraction and consolidation. Hosted Murph agents use tools frequently, so setting this to `true` would make many real sessions ineligible. Use `false` for hosted operator memory unless a later privacy review requires stricter exclusion.

Codex memory defaults are version-sensitive. Hosted Murph must set the intended generation knobs explicitly instead of relying on upstream defaults. At implementation time, verify the exact Codex binary deployed in hosted runs. The reviewer-cited current app defaults are:

- `generate_memories = true`
- `use_memories = true`
- `disable_on_external_context = false`
- `max_rollouts_per_startup = 2`
- `max_rollout_age_days = 10`
- `min_rollout_idle_hours = 6`
- `min_rate_limit_remaining_percent = 25`
- `max_raw_memories_for_consolidation = 256`
- `max_unused_days = 30`
- phase 1 extraction model defaults to `gpt-5.4-mini` with low reasoning
- phase 2 consolidation model defaults to `gpt-5.4` with medium reasoning

The local sibling Codex checkout inspected during planning still showed older memory defaults, no `min_rate_limit_remaining_percent` config key, and a legacy memory extension root. Treat those differences as a version gate: hosted implementation must pin the target Codex version and align the emitted TOML, extension-root denylist, and tests to that version.

## Codebase Alignment

Murph already has hosted bundle machinery that can include narrow `.codex-hosted/**` paths and write a Codex continuity manifest into the operator-home root. The operator-memory implementation should extend that machinery instead of introducing a second snapshot format or a separate content-blob API.

The existing implementation shape to compose with:

- `packages/runtime-state/src/hosted-bundles.ts` owns hosted snapshot inclusion policy, Codex continuity collection, manifest writing, diagnostics, and restore verification.
- `packages/runtime-state/src/hosted-bundle-node.ts` owns restore path safety and already applies private modes to restored `.codex-hosted/**` paths.
- Hosted bundle artifacts already support inline files and externalized artifact refs through `HostedBundleArtifactRef`.
- The current Codex resume continuity layer writes `.murph/hosted-codex-continuity.json`, includes only exact active rollout JSONL files required by assistant session resume state, verifies byte size and SHA-256 on restore, and rejects unmanifested `.codex-hosted/**` files.
- The current Codex resume manifest stores rollout bytes as `hosted-bundle.v1`, not as a separate `hosted-content-blob.v1` object protocol.
- The current verifier is intentionally resume-continuity-only. If operator memory files are restored under `.codex-hosted/memories/**` without extending that verifier, they will be treated as unmanifested Codex-home files.

Simplifying decisions:

- Do not add a new `HostedContentBlobStore` for operator memory in v1.
- Do not make Murph parse or query Codex's private SQLite schema from TypeScript.
- Do not add a Murph-side per-thread memory candidate database in v1.
- Do not retain non-live rollouts unless a Codex-owned bridge explicitly reports that they are pending memory extraction.
- Treat Codex SQLite as an opaque Codex-owned implementation detail. Murph may preserve a Codex-produced sealed state DB backup after Codex has quiesced memory work, but Murph must not copy a live SQLite file or decide which rollouts are pending memory extraction.
- Keep the runtime-state snapshot layer as a path-copying and integrity layer, not a Codex-memory scheduler.
- Do not duplicate the landed Codex continuity allowlist. Extend it into one combined Codex-home restore policy that accepts only resume-continuity rollouts plus operator-memory inventory entries.

These choices keep the architecture composable: Codex owns memory semantics, Murph owns hosted persistence and scheduling boundaries.

## Delivery Shape

Split delivery into small slices.

`v1a: read-only operator memory`

- Support `off` and `read` modes.
- Persist only inventory-backed read-path files, initially `memories/memory_summary.md` and `memories/MEMORY.md`.
- Do not persist Codex state DB.
- Do not run memory maintenance.
- Do not preserve `skills/**`, `raw_memories.md`, `rollout_summaries/**`, `memories/extensions/**`, or any version-specific memory extension root unless a later canary proves they are needed for read mode.
- Suppress or override Codex manual-memory-update instructions. In hosted Murph, user-facing "remember" requests must route to Murph canonical memory, not Codex memory.
- Detect unexpected writes under Codex memory extension roots in read mode, delete them before checkpoint, and record metadata-only diagnostics.
- Keep `MEMORY.md` self-contained or reference only files included by the operator-memory inventory.
- Prove base/full operator memory survives layered hot restores.

`v1b: internal-canary generation`

- Add generation mode for internal canary only.
- Add a Codex-owned bridge that can quiesce memory work, create a sealed state DB backup, and report memory-pending rollout paths.
- Preserve generation-supporting `memories/**` files and bridge-reported memory-pending rollouts.
- Keep generation disabled for production health-user traffic until a Murph-specific extraction prompt or bridge rejects health/profile/product facts before Stage 1 persistence, and privacy lifecycle, reset/delete/export, leakage review, and canary inspection are complete.

`v2: broader generation`

- Add or upstream a completion-aware app-server memory maintenance RPC.
- Consider `skills/**`, `memories/extensions/**`, any version-specific memory extension roots, externalized operator-home artifacts, broader rollout retention, and higher budgets only after v1b has cost, quality, and privacy data.

This structure keeps the first implementation useful and small, while leaving a clear path to reliable generation.

## Privacy Product Contract

Before enabling `generate` outside internal canary, define and implement the product lifecycle for Codex operator memory:

- scope: per member, workspace, vault, assistant profile, or another explicit boundary;
- reset: a product-facing way to clear Codex operator memory independently from Murph canonical memory;
- deletion: account/workspace deletion coverage for inventory files, memory files, memory extension roots, state DB backups, and retained rollouts;
- export: whether export includes memory text, metadata-only presence, or a separate operator-memory export class;
- review: leakage tests proving generated memory rejects health/profile facts and other Murph canonical memory content;
- docs: update hosted deletion/export coverage docs and matching tests in the same change that enables production generation.

The current upstream Codex Stage 1 prompt is user-memory-oriented, not Murph-operator-memory-oriented: it is designed to preserve user preferences and understand the user. That conflicts with Murph's health/profile canonical memory boundary. Production generation from health-user conversations is blocked until the extraction prompt or bridge rejects health/profile/product facts before Stage 1 state DB persistence, not only during final consolidation.

Until this contract exists, `generate` remains internal/dev canary only and must not run on production health-user traffic.

## Checkpoint Classes And Restore Layering

Operator memory is durable operator-home state. Ordinary hot checkpoints are narrow assistant-runtime checkpoints and should not carry broad Codex memory.

Phase 0 is mandatory for v1a. Do not implement memory inventory capture until hot restore no longer clears durable operator-memory paths and the Codex-home restore policy can preserve inventory-backed memory while still rejecting unexpected Codex-home files.

For v1a:

- base/full checkpoints may carry inventory-backed operator memory;
- hot checkpoints may continue to carry exact live Codex resume rollout continuity;
- hot restore must not delete base-restored operator memory;
- hot Codex cleanup should clear only hot-owned continuity paths, or Codex resume continuity should move under a distinct clearable subtree;
- add a layered restore regression test where base/full restores `memories/memory_summary.md`, then hot restore applies an active rollout bundle, and the memory file remains present.

For generation:

- memory maintenance should end in an explicit full/base checkpoint reason named `operator_memory_commit`;
- do not route new operator-memory commits through legacy `maintenance` checkpoint semantics;
- mailbox/import/outbox hot checkpoints must not include `state_*.sqlite`, sealed state DB backups, broad `memories/**`, or memory-pending rollouts.

Before materializing a hosted bundle during restore, preflight Codex-home archive entries:

- allowed entries are exactly resume-continuity manifest paths, active rollout paths required by that manifest, and operator-memory inventory entries;
- reject unsafe paths before materialization, including absolute paths, traversal paths, symlinks, unexpected `.codex-hosted/**` files, and restore targets outside hosted Codex home;
- do not rely only on snapshot-time filtering.

Current-tree note: resume continuity already rejects unmanifested `.codex-hosted/**` files after restore. Operator-memory work should extend that enforcement to a combined continuity-plus-memory allowlist and add mandatory pre-materialization archive preflight for v1a. Keep the post-restore verifier as a defense-in-depth assertion, not as the only guard.

For v1a, keep operator memory inline-only with a strict byte cap. Externalized operator-home memory artifacts are deferred until both snapshot externalization and restore artifact filters explicitly allow inventory-backed `operator-home:.codex-hosted/...` artifact refs.

## Initial Hosted Configuration

Mode mapping must be explicit. Codex memories require both the feature flag and the `[memories]` table.

`off`:

- do not emit `[features].memories = true`;
- do not emit operator-memory `[memories]` settings;
- do not capture or restore operator memory.

`read`:

```toml
[features]
memories = true

[memories]
use_memories = true
generate_memories = false
disable_on_external_context = false
```

`generate` internal canary:

```toml
[features]
memories = true

[memories]
use_memories = true
generate_memories = true
disable_on_external_context = false
min_rollout_idle_hours = 1
max_rollouts_per_startup = 1
max_rollout_age_days = 10
min_rate_limit_remaining_percent = 25
max_raw_memories_for_consolidation = 128
max_unused_days = 30
```

Rationale:

- `use_memories = true` gives the read-path benefit.
- `generate_memories = false` in read mode prevents new hosted threads from becoming extraction candidates before generation is intentionally enabled.
- `generate_memories = true` enables learning only once persistence, privacy lifecycle, and maintenance are in place.
- `disable_on_external_context = false` keeps hosted tool-using sessions eligible.
- `min_rollout_idle_hours = 1` fits wake-on-message hosted behavior better than a 6 or 24 hour default.
- `max_rollouts_per_startup = 1` prevents surprise background spend.
- `min_rate_limit_remaining_percent = 25` makes rate-limit skips explicit in hosted diagnostics instead of depending on an upstream default when the target Codex version supports the knob.
- `max_raw_memories_for_consolidation = 128` keeps consolidation smaller than upstream defaults during canary.

Hosted read mode must make it impossible to enable `[features].memories = true` without also emitting an explicit `[memories]` table. In Codex versions where omitted memory settings default generation on, this prevents accidental extraction eligibility.

Hosted read mode should also suppress Codex's manual memory-update prompt surface. Cleanest option is an upstream config knob such as:

```toml
[memories]
allow_manual_memory_updates = false
```

When the target Codex binary does not support that knob, add a higher-priority hosted developer instruction that forbids writes under `CODEX_HOME/memories`, then keep the read-mode extension-write detector as the safety net.

Do not override `extract_model` or `consolidation_model` in v1 unless cost data shows a need. Prefer upstream defaults until we have quality and spend observations.

Read-only mode has a migration consequence: Codex records threads created with `generate_memories = false` as memory-disabled. Flipping a workspace from `read` to `generate` does not automatically make old threads eligible. If Murph wants read-to-generate migration, use Codex's experimental `thread/memoryMode/set` capability for selected threads after protocol negotiation, or accept that generation only starts from newly created generate-mode threads.

Hosted config must also assert that `CODEX_SQLITE_HOME` is unset. If hosted ever supports a separate SQLite home, the Codex bridge must report the actual sealed DB backup path instead of assuming `state_*.sqlite` under `CODEX_HOME`.

## Persistence Model

Use a separate memory inventory from Codex resume continuity, but store it inside the same hosted bundle format and restore path machinery.

Resume continuity should continue to preserve exactly the rollout JSONL needed for live native resume.

Operator memory should preserve in v1a:

```text
memories/memory_summary.md
memories/MEMORY.md
sessions/**/rollout-*.jsonl only when already required for live resume continuity
```

Operator memory may preserve in generation canary only:

```text
memories/**
sealed Codex state DB backup produced by a Codex bridge
bridge-reported memory-pending sessions/**/rollout-*.jsonl
sessions/**/rollout-*.jsonl already required for live resume continuity
```

Operator memory must not preserve:

```text
auth/**
cache/**
tmp/**
log/**
history.jsonl
session_index.jsonl
archived_sessions/**
credentials
private keys
certificates
sockets
pids
lock files
memories/extensions/** in v1a
any version-specific memory extension root in v1a
```

The state DB is useful for robust incremental generation because Codex memory selection uses thread metadata, `memory_mode`, stage-1 outputs, job leases, success watermarks, selected-for-phase2 markers, and usage timestamps. However, Murph should not inspect those tables directly. A Codex bridge hook should quiesce memory work and produce a sealed DB backup artifact.

Persisting only read-path memory files is sufficient for v1a read mode, but not sufficient for reliable generation, deduplication, and cleanup.

In generation mode, if the Codex bridge cannot quiesce memory work and produce a sealed DB backup, do not claim generation success and disable generation for the next restored run. Read mode may continue. Do not copy live SQLite files opportunistically.

For v1a read-only mode, cap restored operator memory tightly:

```text
memories/memory_summary.md <= 64 KiB
memories/MEMORY.md <= 256 KiB
total v1a operator memory <= 320 KiB
```

These caps keep v1a inline-only and prevent operator memory from turning into a broad hosted Codex-home snapshot.

## Operator Memory Inventory

Add a dedicated inventory file inside the existing hosted bundle:

```ts
interface HostedCodexOperatorMemoryInventoryV1 {
  schema: "murph.hosted-codex-operator-memory.v1";
  generatedAt: string;
  codexStateDb: {
    restoreRelativePath: string;
    backupRelativePath: string;
    sha256: string;
    byteSize: number;
    storage: "hosted-bundle.v1";
    sealedByCodex: true;
  } | null;
  memoryFiles: Array<{
    relativePath: string;
    sha256: string;
    byteSize: number;
    storage: "hosted-bundle.v1";
  }>;
  diagnostics: {
    memoryFileCount: number;
    memoryByteSize: number;
    stateDbByteSize: number | null;
    stateDbSealed: boolean;
  };
}
```

Store this inventory at:

```text
.murph/hosted-codex-operator-memory.json
```

The hosted bundle archive remains the byte authority. The inventory is an integrity and diagnostics index that says which Codex memory files were intentionally included. Do not infer operator-memory persistence by recursively walking `.codex-hosted` during restore.

In v1a, `codexStateDb` is always `null`.

## Path Validation

Validate every inventory path before reading or restoring.

For `memoryFiles`:

- path is relative
- path is normalized
- path has no empty, `.`, or `..` segments
- path starts with `memories/`
- path points to a regular file
- path is not under hidden directories except the top-level `memories` root
- basename does not indicate credentials, sockets, pids, locks, logs, or temp files

For v1a, accepted memory files are only:

```text
memories/memory_summary.md
memories/MEMORY.md
```

Generation canary may widen this to explicit Codex-bridge-reported `memories/**` files after privacy review.

For `codexStateDb`:

- `restoreRelativePath` is relative and root-only under hosted Codex home
- `restoreRelativePath` basename matches `state_*.sqlite`
- `backupRelativePath` is relative, normalized, and points to the bridge-produced sealed backup entry
- neither path has traversal segments
- the backup points to a regular file
- the inventory includes it only after the Codex bridge confirms memory work is quiesced and the backup is sealed

Reject absolute paths and traversal paths everywhere. Diagnostics may include relative paths only when needed; prefer counts and hashes.

Do not use broad path-token rejection inside `memories/**` that would reject valid memory material such as a skill whose name mentions an API key pitfall. Sensitive-content prevention must come from Codex memory prompts, canary inspection, and reset/delete controls, not only from path names.

Memory file contents can contain local paths such as `cwd` or rollout paths. Do not log, print, or include memory contents in diagnostics, docs, generated files, or canary output except through explicitly redacted assertions.

## Snapshot Flow

During hosted checkpoint:

1. Flush active Codex rollout writers through the resume-continuity flush hook.
2. Collect live resume rollout entries through the existing Codex continuity collector.
3. If read-mode operator-memory persistence is enabled, validate and include only v1a read-path memory files.
4. If generation-mode persistence is enabled, call a narrow Codex bridge hook:

```ts
prepareOperatorMemorySnapshot(): Promise<{
  schema: "codex.operatorMemorySnapshotPreparation.v1";
  memoryRelativePaths: string[];
  sealedStateDbBackup: {
    backupRelativePath: string;
    restoreRelativePath: string;
    sha256: string;
    byteSize: number;
  } | null;
  memoryPendingRolloutRelativePaths: string[];
  memoryWorkQuiesced: boolean;
  generationSafeToResume: boolean;
  diagnostics: {
    phase1Running: boolean;
    phase2Running: boolean;
    pendingStage1Count: number | null;
    pendingPhase2: boolean | null;
  };
}>
```

The hook must be Codex-owned. It may quiesce memory work, create a sealed SQLite backup, flush memory files, and decide which rollouts remain pending memory extraction. Murph must use only the reported booleans, diagnostics, hashes, byte sizes, and relative paths. Murph must not inspect Codex SQLite tables, candidate rows, job leases, watermarks, or stage outputs to compute this.

5. Add validated memory paths to the existing operator-home snapshot inclusion allowlist.
6. Add the sealed state DB backup only when `memoryWorkQuiesced = true`, `generationSafeToResume = true`, and the bridge returns one.
7. Add non-live memory-pending rollouts only when the Codex bridge reports them. Live resume rollout inclusion still comes from the existing resume-continuity collector.
8. Write `HostedCodexOperatorMemoryInventoryV1` into the same hosted bundle at `.murph/hosted-codex-operator-memory.json`.
9. Keep default filesystem snapshot walking configured to exclude `.codex-hosted/**` except for the explicit allowlist.

If `generationSafeToResume = false`, preserve read-path memory files when available, but do not claim generation as healthy and do not persist generation-only state as a successful update.

For v1a, operator memory must remain inline-only and under a strict byte cap. If generation artifacts later outgrow inline bundle budgets, extend `shouldExternalizeWorkspaceArtifact` or its successor and the runtime restore artifact filter to support selected inventory-backed operator-home Codex files through `HostedBundleArtifactRef`; do not add a parallel blob-store abstraction.

If Codex creates a fresh state DB and starts asynchronous rollout backfill, maintenance must either wait for backfill completion or report a retryable skip. Do not snapshot a partially backfilled DB as if memory generation is complete.

## Restore Flow

During hosted restore:

1. Parse bundle metadata before materializing `.codex-hosted/**` entries.
2. Build a combined Codex-home allowlist from the resume continuity manifest and operator-memory inventory.
3. Reject every other `.codex-hosted/**` archive entry before writing files.
4. Restore normal Murph runtime state.
5. Restore Codex resume-continuity rollout JSONL files.
6. Read `HostedCodexOperatorMemoryInventoryV1` if present.
7. Validate every inventory path.
8. Restore whitelisted `memories/**` files.
9. Restore whitelisted `state_*.sqlite` only from a sealed Codex DB backup when the inventory says it was sealed.
10. Verify byte size and SHA-256 for every restored operator-memory file.
11. Assert no unmanifested `.codex-hosted/**` file remains.
12. Start Codex app-server with `CODEX_HOME` pointing at the restored hosted Codex home.

If operator memory restore fails:

- fail closed for invalid inventory schema, absolute/traversal paths, symlinks, restore outside hosted Codex home, unsafe state DB paths, or unexpected `.codex-hosted/**` archive entries;
- degrade safely for missing optional memory archive entries, hash mismatch on optional read-path memory, unavailable state DB backup, storage cap exceeded, or maintenance timeout;
- when degrading safely, disable memory for that restore/run, record metadata-only diagnostics, and continue only if Codex resume continuity and Murph workspace restore are valid.

Operator memory is not product truth. Missing or corrupt optional memory must not block mailbox import, outbox delivery, or user-facing response delivery.

## Memory Maintenance Flow

Do not rely on normal user-message startup as the only generation trigger.

Murph users commonly send 5-10 messages per day in the same autocompacted Codex thread. For that pattern, generation mode requires a dedicated maintenance root session. Normal wake-on-message startup is insufficient by design because Codex excludes the current thread, waits for idle time, and uses state DB watermarks to decide whether extraction is needed.

Add a Murph-controlled maintenance lane:

1. Keep one small Murph-owned maintenance state file with last attempt, last success, next eligible time, failure backoff, and generation config version. Do not keep a per-thread candidate queue in v1.
2. On idle wake or post-turn idle time, check whether maintenance is due.
3. Skip if active user input is waiting, a provider turn is running, the container is under cleanup, or memory budget is exhausted.
4. Start a dedicated Codex root maintenance session in the same hosted Codex home.
5. Trigger Codex memory update in one of two ways:
   - Preferred: add a narrow experimental app-server `memory/update` RPC that starts memory work and reports structured completion/status for phase 1, phase 2, and consolidation.
   - Fallback: treat startup/update as trigger-only, then poll a Codex-owned status/quiescence hook before snapshotting.
6. Because the maintenance session is the current thread, prior user threads are not excluded by Codex's current-thread filter.
7. Wait for memory startup/update to finish, or stop after a hard timeout.
8. Snapshot operator memory after the maintenance run.
9. Update the maintenance state file with success, skip, timeout, or retryable failure.

The maintenance session must not send user-visible messages. It is an internal operator-memory job.

Do not simulate memory maintenance by sending a normal user prompt. That would pollute transcripts, spend extra model tokens, and make the system harder to reason about.

The existing Codex core `UpdateMemories` operation is not enough by itself: it starts async memory work and returns immediately. Hosted Murph needs a completion-aware RPC or a separate Codex-owned status hook.

Memory controls are experimental in current app-server protocol. Negotiate app-server capability before calling `thread/memoryMode/set`, `memory/reset`, or any proposed `memory/update`; for older Codex binaries, leave generation disabled and preserve read mode.

Store Murph-owned maintenance state outside `.codex-hosted`, for example:

```text
.runtime/operations/assistant/state/hosted-codex-operator-memory-maintenance.json
```

Give it an explicit schema and version.

## Scheduling And Budgets

Initial internal canary limits:

```text
max_rollouts_per_startup: 1
min_rollout_idle_hours: 1
minimum time between maintenance runs per member/workspace: 6 hours
hard timeout per maintenance run: 2 minutes
max maintenance runs per hosted wake: 1
max operator memory bytes per member/workspace: configurable cap
```

If production generation ever reaches beta after privacy review, start more conservatively:

```text
max_rollouts_per_startup: 1
min_rollout_idle_hours: 2-4 hours
minimum time between maintenance runs per member/workspace: 12-24 hours
max maintenance runs per hosted wake: 1
```

Do not run more than one maintenance attempt per wake. With same-thread daily traffic, frequent maintenance can still spend tokens re-summarizing a large evolving thread even when preserved state DB watermarks prevent duplicate memory rows.

Skip maintenance when:

- active user input is queued,
- a provider turn is running,
- shutdown deadline is near,
- storage cap would be exceeded,
- previous memory maintenance failed recently and backoff has not elapsed,
- Codex state DB is unavailable,
- memory feature flag is disabled,
- current hosted environment is not configured for memory persistence.

Backoff retryable failures. Do not let memory maintenance block user-facing response delivery.

## Pending Rollout Retention

Do not retain non-live rollout JSONL in v1a read mode.

For generation canary, reliable generation needs the rollout files referenced by Codex state DB thread rows. Live resume rollouts alone are not enough once an old thread is no longer live-resumable.

Keep the ownership boundary:

- Murph must not query Codex SQLite to discover pending extraction work.
- Codex bridge may report `memoryPendingRolloutRelativePaths`.
- Murph may retain only those bridge-reported paths, subject to privacy lifecycle and storage cap.
- If the bridge cannot report pending rollout paths, generation is best-effort internal canary only and must tolerate missing rollout files.

Retain a non-live memory-pending rollout only while needed for memory extraction.

Drop a non-live memory-pending rollout when any of these is true:

- stage 1 succeeded for the latest thread `updated_at`,
- job success watermark is at least as new as the thread `updated_at`,
- thread `memory_mode` is `disabled` or `polluted`,
- rollout is older than `max_rollout_age_days`,
- rollout is under `archived_sessions/`,
- storage cap requires eviction and the rollout is not needed for live resume.

Live resume rollouts remain governed by the resume-continuity manifest and must not be evicted by memory retention.

## Privacy Boundary

Codex operator memory may store:

- stable operator preferences,
- repo conventions,
- commands and verification workflows,
- hosted runtime failure modes,
- implementation decisions,
- agent workflow shortcuts,
- tool usage lessons.

Codex operator memory must not be the canonical home for:

- health facts,
- profile facts,
- user goals,
- preferences that Murph product behavior depends on,
- user-facing durable instructions,
- data that users need to inspect, edit, export, or delete through Murph product memory.

If a fact is user-facing, queryable, or product-significant, write it through Murph canonical memory instead.

Generation extraction instructions should prefer repo/operator conventions and reject health/profile facts, user-facing goals, and product memory. This is a prompt-level guardrail, not a replacement for reset/delete/export coverage.

## Diagnostics

Add metadata-only diagnostics:

```text
codexOperatorMemoryEnabled
codexOperatorMemoryUseEnabled
codexOperatorMemoryGenerateEnabled
codexOperatorMemoryInventoryPresent
codexOperatorMemoryFileCount
codexOperatorMemoryBytes
codexOperatorMemoryStateDbBytes
codexOperatorMemoryStateDbSealed
codexOperatorMemoryMaintenanceAttempted
codexOperatorMemoryMaintenanceSkippedReason
codexOperatorMemoryMaintenanceElapsedMs
codexOperatorMemoryMaintenanceTimeout
codexOperatorMemoryIntegrityFailure
```

Diagnostics must not include memory file contents, absolute paths, raw rollout contents, raw prompts, raw user text, secrets, credentials, or local host identifiers.

## Feature Flags

Prefer one product-level mode over several independent booleans:

```text
off
read
generate
```

Mode behavior:

- `off`: do not emit Codex memory config and do not capture operator memory.
- `read`: emit memory read config and persist v1a read-path memory files; do not run maintenance or generate new memory.
- `generate`: emit memory read/write config, persist operator memory, and allow maintenance.

This is easier to reason about than independently configurable read/generate/persist/maintenance flags, where invalid combinations are easy to create. Lower-level kill switches may still exist internally for emergency rollout control, but the product/control-plane surface should expose one mode.

Suggested rollout order:

1. `read` mode with manually seeded memory on internal canary.
2. `read` mode in hosted beta after hot/base restore layering is proven.
3. `generate` mode with maintenance on internal canary after privacy lifecycle is implemented.
4. Hosted generation beta only if Murph-specific extraction and privacy lifecycle are proven, with strict budgets.
5. Broaden only after quality, cost, and privacy review.

## Implementation Phases

### Phase -1: Privacy Product Contract

- Decide operator-memory scope.
- Classify hosted user-facing "remember" requests as Murph canonical-memory requests, not Codex manual memory updates.
- Keep Codex generation traffic internal/dev-only until a Murph-specific extraction prompt or bridge exists.
- Block production health-user generation with the default upstream Codex memory write prompts.
- Add reset semantics.
- Add deletion/export coverage.
- Add leakage review criteria.
- Keep production `generate` disabled until this is complete.

### Phase 0: Codex-Home Restore Policy Hardening

- Extend the landed Codex resume-continuity verifier into a combined Codex-home policy that allows exactly resume rollouts plus operator-memory inventory entries.
- Split hot-owned Codex continuity cleanup from durable operator-memory persistence.
- Ensure hot restore preserves base/full operator memory instead of rejecting it as unmanifested Codex-home state.
- Add Codex-home archive preflight before materialization; keep fail-closed post-restore verification and cleanup for unexpected `.codex-hosted/**` entries as defense in depth.
- Keep v1a operator memory inline-only with byte caps.

### Phase 1: Config Plumbing

- Add hosted Codex config emission for memory flags.
- Keep defaults disabled unless feature flags enable them.
- Add tests that assert the emitted TOML exactly matches intended memory settings.
- Ensure config comments describe operator memory and its boundary from Murph canonical memory.
- Assert `CODEX_SQLITE_HOME` is unset in hosted Codex runtime.

### Phase 2: Read-Mode Memory Inventory

- Add `HostedCodexOperatorMemoryInventoryV1`.
- Add path validation helpers for memory files and state DBs.
- Extend the existing hosted bundle Codex-home allowlist to include v1a read-path operator-memory files.
- Exclude `.codex-hosted/**` from ordinary snapshot walking except for explicit Codex continuity/operator-memory allowlists.
- Capture operator-memory files only through the inventory-backed allowlist.
- Enforce the v1a byte caps for `memory_summary.md`, `MEMORY.md`, and total operator memory.
- Validate that v1a `MEMORY.md` is self-contained or references only files included by the operator-memory inventory.
- Detect and delete unexpected writes under `memories/extensions/**` or version-specific memory extension roots in read mode before checkpoint.
- Restore optional read-path memory with degrade-safe behavior.

### Phase 3: Generation State And Pending Rollouts

- Add the Codex-owned `prepareOperatorMemorySnapshot()` bridge hook for internal canary.
- The hook must quiesce memory work, create a sealed state DB backup, and report memory-pending rollouts.
- Persist a whitelisted sealed state DB backup only when the hook confirms it is safe.
- Persist non-live memory-pending rollouts only when the bridge reports them.
- Restore state DB before Codex app-server startup.
- Prove through a Codex bridge assertion or E2E that Codex can read restored thread metadata, memory modes, jobs, and stage-1 outputs.
- Add integrity checks for hash and byte size.

### Phase 4: Maintenance Session

- Add a hosted runtime maintenance entrypoint that starts a dedicated Codex root session.
- Prefer a completion-aware Codex app-server `memory/update` RPC over prompt-based workarounds.
- Add capability negotiation for experimental memory APIs.
- Run only when no user-facing turn is active or queued.
- Add timeout, backoff, and skip reasons.
- Snapshot operator memory through an explicit full/base checkpoint reason, `operator_memory_commit`, after successful or partially successful maintenance.
- Roll out the checkpoint reason consumer-tolerant first, then producer later.

### Phase 5: Canary And Tuning

- Enable internally with `max_rollouts_per_startup = 1`.
- Inspect generated `memory_summary.md`, `MEMORY.md`, rollout summaries, and any skills through redacted canary review only.
- Measure token spend, latency, storage size, and skipped-run rates.
- Decide whether to raise `max_rollouts_per_startup`, adjust `min_rollout_idle_hours`, or override memory models.

### Deferred: Broader Memory Surfaces

- Do not preserve `skills/**` in read mode until canary proves value.
- Do not preserve `memories/extensions/**` or version-specific memory extension roots in v1a.
- Do not externalize operator-home memory artifacts until restore filters support inventory-backed operator-home refs.
- Do not retain non-live rollout files unless a Codex bridge reports them as memory-pending.
- Keep all future detection inside Codex bridge hooks rather than querying Codex SQLite from Murph.

## Required Tests

1. Config emission:
   - memory feature disabled by default,
   - read-only mode emits `[features].memories = true`,
   - read-only memory mode emits `use_memories = true` and `generate_memories = false`,
   - hosted read mode cannot emit `[features].memories = true` without an explicit `[memories]` block,
   - generation mode emits conservative hosted defaults,
   - generation mode emits explicit `min_rate_limit_remaining_percent` when the target Codex version supports it,
   - hosted runtime rejects or strips `CODEX_SQLITE_HOME`.

2. Inventory path hardening:
   - absolute paths rejected,
   - traversal paths rejected,
   - non-memory paths rejected,
   - existing resume-continuity unmanifested-file rejection remains covered,
   - unexpected `.codex-hosted/**` archive entries are rejected by the combined Codex-home verifier,
   - archived rollout paths are not accepted through operator-memory inventory,
   - state DB restore paths are root-only and must match `state_*.sqlite`,
   - state DB backup paths must be sealed bridge outputs,
   - live rollout path validation remains covered by the Codex resume-continuity tests.

3. Checkpoint layering:
   - base/full restore can restore `memories/memory_summary.md`,
   - applying a hot checkpoint with active Codex rollout continuity does not delete the base-restored memory file,
   - applying a hot checkpoint with active Codex rollout continuity does not reject the base-restored memory file as unmanifested Codex-home state,
   - hot checkpoints do not include broad `memories/**`, sealed state DB backups, or memory-pending rollouts,
   - explicit operator-memory commit checkpoint uses a full/base state class, not legacy `maintenance`.

4. Memory file persistence:
   - `memories/memory_summary.md` restored,
   - `memories/MEMORY.md` restored,
   - `memory_summary.md`, `MEMORY.md`, and total v1a memory byte caps are enforced,
   - v1a `MEMORY.md` with dangling references to missing `rollout_summaries/**`, `skills/**`, or other unpersisted memory files is rejected or canary-detected before beta,
   - `skills/**` ignored in v1a,
   - `memories/extensions/**` and version-specific memory extension roots ignored in v1a,
   - non-whitelisted Codex files are ignored.

5. State DB persistence for generation canary:
   - live SQLite is never copied directly,
   - sealed state DB backup is restored without requiring `-wal` or `-shm` sidecars,
   - Codex bridge assertion or E2E proves restored state preserves memory mode, stage-1 outputs, and success watermarks well enough to avoid duplicate extraction,
   - unavailable sealed backup degrades safely and disables generation for that run.

6. Rollout retention:
   - read mode snapshot does not include non-live rollout files,
   - generation mode includes non-live rollout files only when reported by the Codex bridge,
   - live resume rollout inclusion still comes only from resume-continuity requirements,
   - operator-memory cleanup never removes live resume continuity.

7. Maintenance scheduling:
   - same-thread daily-message cadence with 5-10 turns in one thread does not process the current user thread on ordinary startup,
   - compaction, when triggerable in test, does not make ordinary startup process the current thread,
   - dedicated maintenance session processes the prior user thread after idle cutoff,
   - maintenance does not reprocess the same thread again before minimum maintenance spacing,
   - maintenance skips when user input is queued,
   - maintenance respects timeout and backoff,
   - maintenance does not send a user prompt or create user-visible messages,
   - trigger-only `UpdateMemories` is not treated as completion.

8. Read-path proof:
   - restored `memory_summary.md` is injected on a later hosted Codex turn when memory read is enabled,
   - injection is absent when read flag is disabled,
   - a user-facing "remember X" request in read mode does not create `memories/extensions/ad_hoc/notes` or any version-specific Codex extension note,
   - the "remember X" request routes through Murph canonical memory or is safely handled without creating Codex memory state,
   - checkpoint excludes or deletes unexpected extension-root writes discovered in read mode.

9. Integrity:
   - unsafe inventory paths fail closed,
   - optional memory hash or byte-size mismatch disables memory and degrades safely when resume continuity remains valid,
   - missing operator-memory archive entry records diagnostic and follows fail-closed or degrade-safe semantics.

10. Privacy:
   - diagnostics do not include memory contents,
   - diagnostics do not include absolute local paths,
   - snapshots do not include auth/cache/log/history/temp files,
   - final delivered Murph replies never include `<oai-mem-citation>`, `.codex-hosted`, `memories/MEMORY.md`, `rollout_summaries` paths, rollout ids, or other Codex-memory internals,
   - canary memory-content inspection uses redacted assertions only,
   - generation privacy canary with health/profile facts proves Stage 1 output, `raw_memories.md`, `rollout_summaries/**`, and `memory_summary.md` exclude those facts before production generation can be considered.

11. Budgeting:
   - `max_rollouts_per_startup = 1` limits extraction,
   - storage cap skips operator-memory persistence without affecting live resume continuity,
   - maintenance run cap prevents multiple background generations in one wake.

## End-To-End Proof

Required before read-mode beta:

```text
seed memories/memory_summary.md and self-contained memories/MEMORY.md
take a base/full checkpoint with operator-memory inventory
destroy hosted container
restore base/full checkpoint
apply a hot checkpoint that contains only live Codex resume rollout continuity
verify memory_summary.md remains present
start a new hosted Codex user turn in read mode
verify memory_summary.md is injected
ask "remember X" and verify Codex memory extension notes are not written
verify the request uses Murph canonical memory or is safely handled without Codex memory writes
verify final delivered replies contain no memory citations, Codex-home paths, or rollout internals
verify the original provider session can still resume from rollout continuity
```

Required before generation beta:

```text
start hosted Codex thread with memory generation enabled
finish a user-visible turn
checkpoint hosted state with bridge-reported memory-pending rollout paths
destroy hosted container
restore hosted Codex home from resume continuity and operator-memory inventory
wait until the thread is past min_rollout_idle_hours
start dedicated memory maintenance session
trigger Codex memory update through completion-aware app-server RPC or trigger plus status hook
verify stage-1 output and phase-2 memory files are produced
verify health/profile facts in the source rollout are excluded before Stage 1 persistence for any production-generation path
checkpoint operator memory through explicit full/base operator-memory checkpoint reason
destroy hosted container again
restore only inventory-backed operator memory plus resume-continuity rollout state
start a new hosted Codex user turn
verify memory_summary.md is injected
verify the original provider session can still resume from rollout continuity
```

## Open Questions

- Which product scope should the privacy contract choose: hosted member, workspace, vault, assistant profile, or another explicit boundary?
- Should generation canary persist `skills/**`, or keep generated skills deferred until quality review?
- Should `extract_model` and `consolidation_model` use upstream defaults or cheaper hosted-specific defaults after cost review?
- What storage cap should apply to operator-memory files, sealed state DB backups, and memory-pending rollouts per chosen scope?
- Should maintenance run after every eligible turn or only on idle scheduled wake?
- Can upstream Codex add `allow_manual_memory_updates = false`, or should hosted Murph rely on a higher-priority instruction plus extension-write detection?
- Should Murph add the completion-aware experimental `memory/update` app-server RPC upstream, or use trigger plus status hook until Codex exposes one?

## Working Set

Likely implementation files:

- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/runtime-state/src/hosted-bundles.ts`
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/test/runtime-bridge-workspace.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-*.test.ts`
- `packages/operator-config/src/assistant/**`
- `agent-docs/references/hosted-runtime-protocol.md`
- `ARCHITECTURE.md`

Codex reference areas:

- `../codex/codex-rs/core/src/memories/**`
- `../codex/codex-rs/core/templates/memories/**`
- `../codex/codex-rs/config/src/types.rs`
- `../codex/codex-rs/state/src/runtime/memories.rs`
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
