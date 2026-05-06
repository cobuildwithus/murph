# Hosted Codex Rollout Snapshotting

## Goal

Preserve hosted Codex native resume across container teardown and restore without snapshotting `.codex-hosted` as a durable directory.

The durable invariant is:

```text
Every live Murph assistant session that expects Codex native resume must preserve the exact matching Codex rollout JSONL.
```

The durable invariant is not:

```text
Preserve the whole hosted Codex home.
```

Success means Murph can destroy a hosted container, restore only Murph assistant runtime state plus referenced Codex rollout JSONL blobs, then resume Codex by provider session id / thread id.

## Codex Source Findings

Codex `thread/resume` supports three resume modes: by `thread_id`, by in-memory `history`, or by `path`. The protocol states the precedence is `history > path > thread_id`, and says to prefer `thread_id` whenever possible. Murph should keep using `thread_id` resume and use the rollout path for restore/validation.

Source: `../codex/codex-rs/app-server-protocol/src/protocol/v2.rs`

Codex app-server resume loads stored thread history from the local thread store when no in-memory history is supplied. Murph currently sends only `threadId` through `buildCodexThreadResumeParams`, so local Codex state must contain the matching rollout JSONL after restore.

Sources:

- `../codex/codex-rs/app-server/src/codex_message_processor.rs`
- `packages/assistant-engine/src/assistant-codex/app-server-requests.ts`

Codex local thread-store reads SQLite metadata first when available, but it validates that the SQLite rollout path can still load history for the requested thread. If SQLite is missing or stale, it falls back to locating a rollout file by thread id under `sessions/`. If no rollout file is found, resume fails with `no rollout found for thread id ...`.

Source: `../codex/codex-rs/thread-store/src/local/read_thread.rs`

Codex rollout path lookup validates the id as a UUID, checks SQLite if present, then falls back to a capped file search under `sessions/`. Archived lookup is separate. Restoring only the referenced active rollout under `sessions/YYYY/MM/DD/` keeps this search small and sufficient.

Source: `../codex/codex-rs/rollout/src/list.rs`

Codex rollout recorder has a real `flush()` operation that waits for queued rollout writes to be committed. Snapshotting should call a bridge-level flush before reading rollout JSONL files.

Source: `../codex/codex-rs/rollout/src/recorder.rs`

Codex `state_*.sqlite` is optional for basic resume. Missing state DB returns `None`; resume can still load history from the rollout JSONL.

Source: `../codex/codex-rs/rollout/src/state_db.rs`

Codex `history.jsonl` is prompt-entry history under Codex home and is skipped when history persistence is `none`. It is not provider resume state.

Source: `../codex/codex-rs/core/src/message_history.rs`

## Non-Goals

- Do not preserve all of `.codex-hosted`.
- Do not preserve archived sessions in v1.
- Do not preserve Codex logs, log SQLite DBs, prompt history, cache, temp files, credentials, sockets, pids, lock files, or local Codex UI history.
- Do not preserve `state_*.sqlite` in v1.
- Do not switch Murph to Codex `thread/resume.path` as the default resume mechanism.
- Do not build a broad provider continuity plugin framework for this change.

## Data Model

Extend Codex-backed Murph assistant resume state with a hosted Codex rollout path:

```ts
resumeState: {
  providerSessionId: string
  resumeRouteId?: string
  codexRolloutRelativePath?: string
}
```

`providerSessionId` remains the Codex thread id used for `thread/resume`.

`codexRolloutRelativePath` is relative to hosted Codex home:

```text
sessions/YYYY/MM/DD/rollout-YYYY-MM-DDThh-mm-ss-<threadId>.jsonl
```

Capture this path from Codex `thread/start` and `thread/resume` responses. Codex exposes it as `thread.path`.

Store only a normalized relative path. Never persist an absolute local path in Murph state, logs, fixtures, or docs.

## Continuity Manifest

Add a tiny manifest separate from the normal filesystem snapshot:

```ts
interface HostedCodexContinuityManifestV1 {
  schema: "murph.hosted-codex-continuity.v1"
  threads: Array<{
    providerSessionId: string
    codexRolloutRelativePath: string
    rolloutBlob: {
      sha256: string
      byteSize: number
      storage: "hosted-content-blob.v1"
    }
  }>
}
```

The manifest is the only authority for Codex rollout persistence. If a rollout is not referenced by the manifest, it is not part of the hosted checkpoint.

## Snapshot Collection Flow

1. Read Murph assistant runtime session state.
2. Find live sessions whose resume state belongs to the Codex provider and has `resumeState.providerSessionId`.
3. Call `hostedCodexBridge.prepareContinuitySnapshot()`.
4. The bridge flushes active Codex rollout writers and returns active `threadId -> rolloutRelativePath` mappings.
5. Resolve each live session's rollout path:
   - first use `resumeState.codexRolloutRelativePath`
   - otherwise use the bridge mapping from `prepareContinuitySnapshot()`
   - migration fallback only: targeted, capped lookup for `rollout-*<threadId>.jsonl` under active `sessions/`
6. Validate every resolved rollout path.
7. Stream/hash/upload exactly that rollout JSONL as a content blob.
8. Write `HostedCodexContinuityManifestV1` into the small checkpoint bundle.
9. Snapshot normal Murph runtime/workspace state with `.codex-hosted/**` excluded by default.

## Rollout Path Validation

Before reading or restoring a rollout file, require:

```text
path is relative
path is normalized
path has no empty segments other than normal separators
path has no "." or ".." segments
path matches sessions/YYYY/MM/DD/
path does not start with archived_sessions/
basename matches rollout-YYYY-MM-DDT...-<threadId>.jsonl
date path matches rollout filename date
file exists and is a regular file
thread id in filename exactly matches providerSessionId
```

Reject absolute paths and traversal paths.

Reject archived rollout paths in v1. If a live Murph resume state points at `archived_sessions/`, idle checkpoint should skip and active correctness checkpoint should fail closed.

## Flush Contract

Add a narrow bridge hook:

```ts
prepareContinuitySnapshot(): Promise<Array<{
  providerSessionId: string
  codexRolloutRelativePath: string
}>>
```

The hook must:

```text
flush active Codex rollout recorders
wait until queued writes are committed
return current active thread id to rollout relative path mappings
```

This is needed because Codex rollout writes can be queued. Without a flush, Murph may snapshot a stale JSONL missing the latest turn, compaction record, or persisted response item.

If this hook is unavailable or fails:

```text
idle shutdown checkpoint: skip Codex continuity capture and keep the latest valid checkpoint
active correctness checkpoint: fail closed
```

## Snapshot Inclusion Policy

Default:

```text
operator-home/.codex-hosted/**
  excluded
```

Included only through the Codex continuity manifest:

```text
operator-home/.codex-hosted/sessions/.../rollout-*.jsonl
```

Never include for v1 core resume:

```text
operator-home/.codex-hosted/archived_sessions/**
operator-home/.codex-hosted/log/**
operator-home/.codex-hosted/logs*.sqlite
operator-home/.codex-hosted/history.jsonl
operator-home/.codex-hosted/session_index.jsonl
operator-home/.codex-hosted/state_*.sqlite
operator-home/.codex-hosted/cache/**
operator-home/.codex-hosted/tmp/**
operator-home/.codex-hosted/auth/**
credential/key/cert/socket/pid/lock paths
```

Also configure hosted Codex logs outside persisted home, for example with `log_dir` pointing at a temp path.

## Restore Flow

1. Restore Murph assistant runtime state.
2. Read `HostedCodexContinuityManifestV1`.
3. For each manifest entry:
   - validate `codexRolloutRelativePath`
   - recreate the parent directory under hosted Codex home
   - stream the blob back to that relative path
   - verify byte size and SHA-256
4. Start Codex app-server with hosted Codex home restored.
5. Resume by `providerSessionId` as Codex `threadId`.

Do not recreate Codex SQLite metadata for v1. Codex local thread-store can resolve the restored rollout by thread id from `sessions/`.

## Storage Requirements

Rollout files can be large. Do not upload them through an artifact path that buffers the entire encrypted object in memory.

Add a streamed/chunked content blob API:

```ts
interface HostedContentBlobStore {
  putFile(input: {
    absolutePath: string
    purpose: "codex-rollout" | "snapshot-artifact" | "snapshot-bundle"
  }): Promise<HostedContentBlobRef>

  getToFile(input: {
    ref: HostedContentBlobRef
    absolutePath: string
  }): Promise<void>
}
```

The container should stream the file to compute `sha256`, then upload chunks through the Worker. The Worker validates the active lease and streams each chunk to R2 without buffering the full object.

## Failure Semantics

Idle shutdown checkpoint is compaction, not an active user correctness fence:

```text
missing referenced rollout -> skip idle full checkpoint
flush failure -> skip idle full checkpoint
upload/hash failure -> skip idle full checkpoint
do not poison the latest valid checkpoint
allow the container to sleep
```

Active correctness checkpoints must fail closed:

```text
missing referenced rollout -> fail checkpoint
flush failure -> fail checkpoint
hash mismatch -> fail checkpoint
restore mismatch -> fail checkpoint
```

## Diagnostics

Stop diagnostics from recursively walking `.codex-hosted`.

Report manifest-derived counters instead:

```text
codexResumeThreadCount
codexResumeRolloutBytes
codexResumeRolloutFileBytes
codexResumeMissingRolloutCount
codexResumeInvalidPathCount
codexResumeFlushFailed
codexResumeArchivedUnsupportedCount
```

Diagnostics must not log absolute local paths. Use keyed hashed rollout-relative
identifiers, not raw rollout filenames or thread ids. Snapshot failures must
write a bounded `workspace.codex_home_snapshot_failed` runtime log with the
redacted full error message, error name, snapshot mode, checkpoint reason, and
the same Codex continuity counters/file-size diagnostics when available.

## Phases

### Phase 0: Safety Mitigation

- Keep idle full checkpoint disabled or feature-gated until large content storage is safe.
- Move hosted Codex `log_dir` to temp/non-snapshotted storage.
- Exclude Codex logs, log DBs, history, state DBs, cache, temp, auth, and credentials from any current `.codex-hosted` inclusion.

Status: completed

### Phase 1: Precise Codex Continuity

- Capture `thread.path` from Codex start/resume responses.
- Persist `resumeState.codexRolloutRelativePath`.
- Add `HostedCodexContinuityManifestV1`.
- Add collection/restore validation for active `sessions/` rollout files only.
- Exclude `.codex-hosted/**` from regular snapshot walking.

Status: completed

### Phase 2: Flush Hook

- Add `hostedCodexBridge.prepareContinuitySnapshot()`.
- Flush active Codex rollout writers before reading rollout files.
- Return active thread id to rollout relative path mappings.

Status: completed

### Phase 3: Streamed Content Blob Store

- Add bounded-memory `putFile` and `getToFile`.
- Use it for Codex rollout JSONL blobs.
- Extend later to large snapshot artifacts and bundles.

Status: completed

### Phase 4: Restore Proof

- Restore only Murph runtime state plus referenced rollout JSONL blobs.
- Do not restore Codex SQLite, logs, prompt history, session index, or archived sessions.
- Prove `thread/resume` by provider session id works after deleting hosted Codex home.

Status: completed

### Phase 5: Re-enable Idle Full Checkpoint

Only re-enable after tests prove:

```text
huge .codex-hosted is ignored
active rollout is persisted
restore without SQLite resumes by thread id
Worker memory stays bounded
missing rollout behavior is fail-closed or skip according to checkpoint type
```

Status: completed

## Required Tests

1. Huge Codex home exclusion:
   - create thousands of old session files
   - create large sparse log/log DB files
   - prove snapshot does not walk/read/upload them
2. Active rollout inclusion:
   - one live Codex `resumeState.providerSessionId`
   - one `codexRolloutRelativePath`
   - snapshot includes only that rollout blob plus manifest
3. Unreferenced sessions ignored:
   - active but unreferenced rollout files are not snapshotted
4. Archived sessions unsupported:
   - `archived_sessions/` path is rejected in v1
   - idle checkpoint skips
   - active correctness checkpoint fails
5. No SQLite restore:
   - restore without `state_*.sqlite`
   - Codex resumes by thread id because rollout exists under `sessions/`
6. Large rollout:
   - rollout larger than Worker memory-safe single-buffer threshold
   - upload and restore succeed with bounded memory
   - Status: deferred by explicit user scope for this pass.
7. Missing rollout:
   - referenced rollout missing
   - idle checkpoint skips without poisoning previous checkpoint
   - active checkpoint fails closed
8. Compacted rollout:
   - after Codex compaction, checkpoint preserves the current rollout JSONL
   - restored resume includes the compacted state
9. Restore integrity:
   - byte-size mismatch fails restore
   - SHA-256 mismatch fails restore
10. Path hardening:
   - absolute paths rejected
   - traversal paths rejected
   - non-rollout basenames rejected
   - wrong thread id rejected

## End-To-End Proof

Required before shipping:

```text
start hosted Codex thread
capture providerSessionId and codexRolloutRelativePath
finish a turn
flush and checkpoint
delete hosted Codex home
restore only manifest-referenced rollout JSONL
start Codex app-server
call thread/resume by providerSessionId
verify the same thread continues
```

Status: completed

## Open Assumptions

- Hosted Codex uses the local thread store. If Murph enables Codex remote thread-store, this plan changes.
- `providerSessionId` for Codex sessions is the Codex thread id UUID.
- Non-Codex providers never enter the Codex continuity manifest.
- Active sessions only in v1 means `sessions/` only. `archived_sessions/` is unsupported.
- Murph does not need Codex-native local UI history, prompt-entry history, thread titles, logs, or SQLite metadata for v1 resume continuity.

## Implementation Notes

- Keep resume by `threadId`; do not default to unstable path resume.
- Treat `codexRolloutRelativePath` as restore identity and validation context.
- Target architecture stores rollout bytes as content blobs, not inline bundle payloads; current Phase 1 implementation still stores them in hosted bundles until Phase 3 lands.
- Never log or persist absolute local paths.
- Do not trim, summarize, or reconstruct rollout JSONL. Preserve exact bytes.
- Keep this implementation narrow. Avoid creating a provider plugin framework until another provider requires equivalent durable local state.
Updated: 2026-05-07
Completed: 2026-05-07
