# Remove Codex Continuity Manifest

## Goal

Delete the hosted Codex continuity manifest and global repair path, replacing them with simpler best-effort provider-cache snapshotting plus narrow restore-time session sanitization.

Success criteria:

- Hosted snapshots no longer create or require `.murph/hosted-codex-continuity.json`.
- Missing, invalid, archived, or unflushed Codex rollout files do not fail idle checkpoint or full snapshot creation.
- Restore never clears all Codex resume state because of extra `.codex-hosted/**` files.
- Restore clears only the assistant session whose referenced rollout is missing or unsafe.
- Normal `session-thread` turns get bounded committed transcript fallback when native Codex resume is unavailable or stale-resume fallback starts a fresh thread.
- Isolated fresh threads do not replay committed transcript history.
- Focused tests prove the new snapshot, restore, stale-resume, and transcript-fallback behavior.

## Constraints

- Default to deletion and radical simplicity. Do not add a replacement manifest, repair registry, compatibility service, or second continuity abstraction unless a failing test proves it is required.
- Treat Codex native resume as an optimization. Durable conversation recovery must come from mailbox/transcript/session state when provider cache is unavailable.
- Do not make provider-cache completeness a checkpoint invariant.
- Do not expose secrets, raw prompts, transcripts, local usernames, home paths, or direct personal identifiers in docs, logs, tests, fixtures, or commits.
- Preserve unrelated working-tree edits and do not stop or kill running hosted-local, e2e, or dev processes unless explicitly asked.

## Current Facts

- `packages/runtime-state/src/hosted-bundles.ts` writes `.murph/hosted-codex-continuity.json`, hard-fails snapshots through `assertHostedCodexContinuityComplete`, and verifies manifest coverage plus per-rollout bytes/SHA on restore.
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts` catches manifest verification failures, classifies reasons such as `unmanifested_home_file`, clears every session with Codex resume state, and removes `.codex-hosted`.
- Direct v2 snapshots are encrypted/authenticated as a whole archive. Legacy bundle artifacts already carry their own artifact refs/hashes. The separate per-rollout manifest is duplicate metadata.
- Assistant planning currently avoids committed transcript replay when provider-native resume is unavailable. That makes provider-cache loss non-fatal at runtime but still context-hostile.
- The session resume record already names the rollout file. The prepare hook can flush/snapshot warm Codex state, but it should not invent or override durable session-to-rollout mapping.

## Target Architecture

Codex provider cache becomes optional local runtime residue:

```txt
Assistant session state:
  codex resume thread id
  route fingerprint
  optional normalized rollout relative path

Snapshot:
  include vault/runtime state
  include only safe regular rollout files directly referenced by session state
  record diagnostics counts for missing/invalid provider-cache files

Restore:
  restore durable state
  check each session's referenced rollout path directly
  clear only unusable resume records
  ignore unrelated .codex-hosted files

Fallback:
  if native resume cannot be used, send bounded recent user/assistant transcript history
  keep status/error/tool audit entries out of model-history replay
```

No manifest, no allowlist verifier, no global repair.

## Implementation Plan

### 1. Simplify Snapshot Collection

In `packages/runtime-state/src/hosted-bundles.ts`:

- Delete manifest constants, manifest creation/parsing, manifest verification, and manifest drift logic.
- Keep the active rollout relative path validator and symlink-safe regular-file inspection.
- Rename the collection helpers around the actual behavior, for example from Codex continuity manifest collection to referenced Codex rollout collection.
- Make collection best-effort:
  - safe referenced rollout exists: add `.codex-hosted/<rollout>` to explicit operator-home files
  - missing rollout: diagnostics only
  - invalid path: diagnostics only
  - archived/unsupported path: diagnostics only
  - prepare hook failure: diagnostics only
- Remove `assertHostedCodexContinuityComplete` from full, delta, hot, and direct v2 snapshot paths.
- Do not let prepared hook output override a session rollout path. Trust the session path when present; otherwise do not synthesize durable mapping from prepare output.

### 2. Replace Restore Repair With Session Sanitization

In `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`:

- Delete `verifyOrRepairRestoredHostedCodexContinuity`, `repairRestoredHostedCodexContinuity`, repair reason classification, and `workspace.codex_continuity_repaired` emission.
- Add a narrow sanitizer that walks assistant session files and normalizes current plus legacy Codex resume state.
- For each session:
  - no Codex resume: leave unchanged
  - no rollout path: clear native resume, because no local provider cache can be proven
  - invalid rollout path: clear only that session resume
  - referenced rollout missing or not a regular non-symlink file: clear only that session resume
  - referenced rollout present and safe: leave resume intact
- Ignore extra `.codex-hosted/**` files.
- Keep legacy pre-restore clearing of `.codex-hosted` before applying old base/hot/delta bundles so stale cache from a previous restore cannot mix into the next restore.

### 3. Add Transcript Fallback For Native Resume Loss

In `packages/assistant-engine`:

- Add a small provider-history field or reuse `activeTurnMessages` only if the diff stays clear. Prefer a separate field if it avoids labeling committed history as "Active turn so far."
- Build bounded recent transcript history for normal `session-thread` plans when native resume is unavailable.
- Carry the same bounded history into stale-resume fresh-thread fallback.
- Filter transcript entries to `kind: "user"` and `kind: "assistant"` only.
- Do not replay committed history for isolated fresh threads.
- Avoid duplicating the current user prompt:
  - stop replay before the current input's transcript ref when available, or
  - de-dupe a trailing committed user entry that exactly matches the current prompt.
- Serialize file/image content through the existing bounded provider content serializer; do not replay raw attachment bodies beyond existing prompt limits.

### 4. Update Runtime Logs And Contracts

- Remove `workspace.codex_continuity_repaired` if no producer remains.
- Keep `workspace.codex_home_snapshot` diagnostics if they still report useful best-effort counts.
- Reword any `workspace.codex_home_snapshot_failed` semantics so provider-cache flush failure is not treated as checkpoint failure.
- Update `agent-docs/references/hosted-runtime-protocol.md` and `packages/runtime-state/README.md` to remove "tiny continuity manifest" language.

### 5. Update Tests

Expected test rewrites:

- Snapshot tests should assert exact referenced rollout files are included and manifest files are absent.
- Missing/invalid/archived/symlink rollout snapshot tests should assert snapshot success plus diagnostics, not snapshot failure.
- Restore tests should assert extra `.codex-hosted/**` files do not clear valid resume state.
- Restore tests should assert missing referenced rollout clears only the affected session.
- Legacy restore tests should keep stale-cache replacement behavior without manifest verification.
- Planner/provider tests should invert the current "does not replay committed transcript messages when provider-native resume is unavailable" case for normal `session-thread`.
- Stale-resume fallback tests should assert fresh fallback includes bounded transcript history.
- Isolated-thread tests should continue asserting no committed transcript replay.

Recommended focused commands after implementation:

```sh
pnpm typecheck
pnpm --dir packages/runtime-state exec vitest run --config vitest.config.ts test/hosted-bundle.test.ts --no-coverage
pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-workspace-restore-codex-continuity.test.ts --no-coverage
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-protocol-index-planning.test.ts test/codex-runtime-helpers.test.ts --no-coverage
```

Use `pnpm test:diff <changed paths>` if it truthfully covers the final changed surface; otherwise run the package-local coverage lanes required by the verification map.

## Edge Cases To Protect

- Multiple sessions referencing the same rollout dedupe the explicit snapshot file.
- A safe rollout for one session is preserved even if another session has a missing rollout.
- Extra `.codex-hosted` files are ignored on warm and cold restore.
- Symlinks and parent-directory symlinks are never included as rollout files.
- Prepared flush output that conflicts with session state does not fail the snapshot and does not override the session state.
- No operator-home root inside the durable snapshot root means provider cache is simply absent; checkpoint still succeeds.
- Legacy snapshots that contain an old manifest treat it as inert data, not as restore authority.
- Transcript fallback does not include status/error/audit entries as model conversation.
- Transcript fallback does not duplicate the current user message.
- Transcript fallback respects existing bounded retention and content serialization.

## Non-Goals

- Do not remove transcript persistence. It still supports accepted-turn refs, audit, receipts, and active-turn bookkeeping.
- Do not build a new provider-neutral conversation-memory system.
- Do not preserve arbitrary `.codex-hosted` state.
- Do not add a new repair event or background cleanup process unless tests prove user-visible behavior needs it.

## Working Set

- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/test/hosted-bundle.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-restore-codex-continuity.test.ts`
- `packages/assistant-engine/src/assistant/codex-turn/planning.ts`
- `packages/assistant-engine/src/assistant/providers/helpers.ts`
- `packages/assistant-engine/src/assistant/providers/types.ts`
- `packages/assistant-engine/src/assistant/providers/codex-cli.ts`
- `packages/assistant-engine/test/assistant-protocol-index-planning.test.ts`
- `packages/assistant-engine/test/codex-runtime-helpers.test.ts`
- `packages/hosted-execution/src/runtime-control.ts`
- `apps/cloudflare/test/runtime-bridge-workspace.test.ts`
- `agent-docs/references/hosted-runtime-protocol.md`
- `packages/runtime-state/README.md`

## State

Done:

- Audited manifest, snapshot, restore, and transcript-fallback call sites.
- Confirmed manifest/repair removal is simpler and removes the observed unmanifested-file failure mode.
- Confirmed transcript fallback must land with manifest deletion to preserve user-visible continuity when provider-native resume is unavailable.

Now:

- Ready for implementation.

Next:

- Update the existing coordination-ledger row to in-progress before code changes.
- Delete manifest/repair first, then add narrow sanitizer and transcript fallback.
- Run focused tests and required verification.

Status: planned
Updated: 2026-06-04
