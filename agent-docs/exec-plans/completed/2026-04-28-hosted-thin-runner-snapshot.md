# Hosted Thin Runner Snapshot Plan

## Goal

Make Cloudflare hosted execution behave like a thin runner over the local assistant runtime: restore an encrypted filesystem snapshot, run the normal assistant runtime once, checkpoint the resulting filesystem snapshot, and keep Cloudflare/Web limited to coordination, auth, leases, mailbox ingress, artifact storage, and wake scheduling.

Success means a file that the local assistant runtime needs after a normal restart survives hosted checkpoint/restore without requiring a new per-file descriptor entry. Hosted should not silently drop new assistant runtime continuity files.

## Current Problem

Hosted execution currently restores a normal vault-like filesystem, but checkpoint inclusion for `.runtime/**` is controlled by the local-state descriptor portability allowlist in `packages/runtime-state/src/hosted-bundles.ts`.

The specific brittle point is `shouldIncludeWorkspaceSnapshotVaultRelativePath()`:

- Non-runtime vault paths are included by default unless specifically excluded.
- Runtime paths are excluded unless a descriptor says `portable`, or the path is a portable operational container.
- Assistant runtime continuity files therefore require explicit entries in `packages/runtime-state/src/assistant-local-state-descriptors.ts`.
- When a new hosted runtime file is written but not described, local behavior and Cloudflare behavior diverge.

Recent symptom: `hosted-system-mailbox.json` was written by assistant runtime, but absent from the hosted bundle descriptor list, so hosted checkpoint/restore could drop system-mailbox pending state. That caused first-contact/message processing to appear successful at the runner level while no provider turn or outbound reply happened.

## Existing Code Shape

Important files:

- `packages/runtime-state/src/hosted-bundles.ts`
  - `snapshotHostedExecutionContext()`
  - `restoreHostedExecutionContext()`
  - `shouldIncludeWorkspaceSnapshotVaultRelativePath()`
  - `shouldExternalizeWorkspaceArtifact()`
- `packages/runtime-state/src/hosted-bundle-node.ts`
  - multi-root archive snapshot/restore mechanics
  - artifact externalization and restore safety
- `packages/runtime-state/src/assistant-state.ts`
  - assistant runtime path layout
- `packages/runtime-state/src/assistant-local-state-descriptors.ts`
  - current per-path portability declarations
- `packages/assistant-runtime/src/hosted-runtime.ts`
  - `runHostedWorkspaceRuntimeJobInProcess()`
  - restores workspace, imports mailbox, runs assistant phase, checkpoints
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
  - restores snapshot into ephemeral local roots for the hosted invocation
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
  - creates new hosted bundle checkpoint snapshot after runtime changes
- `apps/cloudflare/src/node-runner.ts`
  - Cloudflare-side invocation runner and lease bridge
- `apps/cloudflare/src/runtime-platform.ts`
  - web-control and artifact platform adapters

Current architecture is close to thin-runner already. The divergence is the snapshot filter policy.

## Review Reconciliation

Three high-effort review passes returned the same verdict: **modify**.

The architecture direction is right, but the first draft was too broad. Do not snapshot all `.runtime/**` or all `.runtime/operations/**` by default. The simplest safe architecture is narrower:

- Include assistant runtime continuity under `vault/.runtime/operations/assistant/**` by default.
- Apply a small explicit hosted denylist for unsafe/process-local state.
- Leave non-assistant `.runtime/**` roots on the existing descriptor portability model.

This keeps Cloudflare thin over the local assistant runtime without widening the blast radius to device-sync, inbox daemon, parser toolchain, projections, cache/tmp, or other machine-local operational roots.

## Proposed Architecture

Invert the snapshot policy only for hosted assistant-runtime continuity.

### Include By Default

Hosted workspace snapshot should include:

- `vault/**`
- `vault/.runtime/operations/assistant/**`
- non-assistant `.runtime/**` paths only when they already satisfy the existing descriptor portability rules
- `operator-home/.murph/config.json` and other explicitly required hosted operator config
- raw artifacts under `vault/raw/**`, still using existing externalization for large/binary files

This snapshot is stored as encrypted hosted workspace state. Cloudflare does not need to understand the internal assistant runtime file set.

### Exclude By Default

Keep a small hard denylist for unsafe, process-local, or non-continuity material:

- `.git/**`
- `.env`, `.env.*`, and any environment files
- `exports/packs/**`
- `.runtime/tmp/**`
- `.runtime/cache/**`
- `.runtime/projections/**`
- `.runtime/operations/assistant/secrets/**`
- `.runtime/operations/assistant/.runtime-write.lock/**`
- `.runtime/operations/assistant/.runtime-write.lock.{pending,stale,cleanup}.*`
- `.runtime/operations/assistant/.automation-run.lock/**`
- `.runtime/operations/assistant/.automation-run.lock.{pending,stale,cleanup}.*`
- `.runtime/operations/assistant/.locks/**`
- assistant lock files, pid files, sockets, temp lock directories, and other process-local files
- `.runtime/operations/assistant/quarantine/**`
- `.runtime/operations/assistant/outbox/.quarantine/**`
- local machine credential files that are not generated inside the hosted user/runtime encryption boundary
- `operator-home/.murph/hosted/**` and other operator-home user/env secret config

Do not include all `.runtime/operations/**` by default. Device-sync, parser, inbox daemon, and other local process roots remain machine-local unless explicitly classified portable.

Exclude `.runtime/projections/**` initially. Projections are rebuildable and can be large; if hosted correctness depends on a projection, fix that dependency or document a specific exception rather than carrying all projections in the checkpoint.

### Do Not Use Per-File Allowlist For Continuity

Demote `assistant-local-state-descriptors.ts` from being the hosted checkpoint allowlist for assistant continuity. It can remain useful for docs, audits, doctor/repair, and explicit exclusions, but a new assistant runtime continuity file should not need a descriptor to survive.

The invariant should become:

> If the hosted assistant runtime writes durable operational state under `.runtime/operations/assistant/**`, hosted checkpoint/restore preserves it unless it matches a small explicit unsafe/process-local exclusion.

## Expected Simplification

This should remove the repeated need to add entries such as:

- `hosted-mailbox.json`
- `hosted-system-mailbox.json`
- future active-turn/mailbox/outbox/automation files

It also makes local and hosted semantics easier to reason about:

- local restart: assistant sees its runtime filesystem again
- hosted restart: assistant sees its encrypted runtime filesystem again

Cloudflare remains a runner/coordinator, not a second runtime-state classifier.

## Invariants To Preserve

Security:

- Never snapshot `.env*`.
- Never snapshot local non-hosted process env or ambient machine credentials.
- Do not log or fixture raw hosted mailbox payloads, credentials, provider headers, or direct contact identifiers.
- Restored hosted workspace directories should remain private mode where applicable.
- Existing symlink/path traversal restore protections in `hosted-bundle-node.ts` must remain.

Reliability:

- Workspace checkpoint must remain versioned and lease-guarded.
- Existing artifact hash/integrity checks must remain.
- Large/binary `raw/**` externalization should still work.
- Snapshot restore must not resurrect deleted materialized artifacts incorrectly.
- If projections are excluded, runtime must tolerate rebuild or absence.
- Diagnostics, journals, cron run logs, and status are assistant-runtime observability and should persist across hosted invocations unless a specific file is proven unsafe.

Product/data model:

- Assistant runtime state is still non-canonical execution residue.
- User-facing product truth must still live in canonical vault or web-owned hosted control-plane tables, not assistant runtime.
- The change is about continuity of runtime execution, not promoting runtime files to canonical product truth.

## Candidate Implementation Direction

1. Replace the assistant-runtime part of the `.runtime/**` branch in `shouldIncludeWorkspaceSnapshotVaultRelativePath()` with an assistant include-by-default rule.
2. Add helpers such as:
   - `isHostedSnapshotExcludedRelativePath(relativePath)`
   - `isRuntimeCacheOrTempRelativePath(relativePath)`
   - `isAssistantRuntimeProcessLocalRelativePath(relativePath)`
3. Keep the existing non-runtime exclusions:
   - `.git`
   - `.env*`
   - `exports/packs`
4. Decide projection policy explicitly:
   - exclude `.runtime/projections/**`
   - document that projections are rebuildable and should not drive correctness
5. Add tests in `packages/runtime-state/test/hosted-bundle.test.ts` proving:
   - unknown assistant operational files are included by default
   - actual active-turn journal paths under `state/accepted-turn-inputs/*` survive even without a matching descriptor
   - `hosted-system-mailbox.json` survives without a descriptor-specific assertion
   - `.runtime/tmp/**`, `.runtime/cache/**`, `.runtime/projections/**`, `.env*`, `.git/**`, and export packs are omitted
   - assistant secrets, quarantines, locks, sockets, pid files, and temp lock directories are omitted
   - assistant diagnostics, journals, status snapshots, cron run logs, provider-route recovery, and runtime budgets survive by default
   - non-assistant operational state remains descriptor-gated
   - raw artifact externalization behavior is unchanged
6. Add or update hosted local E2E coverage for the production-shaped first-contact path:
   - activation system event and welcome/notification request both present before first wake
   - first invocation may checkpoint and schedule a second wake
   - second invocation must still see pending system mailbox state
   - provider call and outbound reply/delivery intent must occur

## Stress-Test Questions For Review Agents

1. Is include-by-default for `vault/.runtime/operations/assistant/**` plus denylist sufficient to stop hosted/local divergence?
2. Are any denied assistant paths actually required for correctness rather than diagnostics or repair?
3. Is `provider-route-recovery/**` safe to exclude, or does hosted failover need it across invocations?
4. Are assistant secret sidecars ever generated by hosted runtime in a way that cannot be reconstructed from runner/user secret injection?
5. Are `.runtime/projections/**` ever required for correctness in hosted, or can they always be rebuilt?
6. Does broader assistant snapshotting materially increase bundle size, checkpoint latency, or artifact churn?
7. Does restoring more assistant files create duplicate sends, duplicate cron execution, or stale lock hazards?
8. Which docs should describe the hosted assistant-runtime exception to operational machine-local defaults?
9. What is the smallest code change that produces local-hosted semantic equivalence without weakening security boundaries?

## Non-Goals

- Do not move canonical hosted product truth out of `apps/web` or canonical vault records.
- Do not make Cloudflare inspect assistant runtime internals.
- Do not weaken workspace lease/version checks.
- Do not snapshot `.env*`, process-local sockets/locks, or ambient machine credentials.
- Do not add a new web route/table/cursor lifecycle for this.

## Review Outputs Requested

Each reviewer should return:

- Verdict: accept, modify, or reject the plan.
- Top risks with exact file references.
- Files/functions that would need changes.
- Specific tests required before this can land.
- Any simpler architecture they recommend instead.

## Implementation Status

Implemented in `packages/runtime-state/src/hosted-bundles.ts` with focused bundle coverage in `packages/runtime-state/test/hosted-bundle.test.ts`.

Verified:

- `pnpm exec vitest run packages/runtime-state/test/hosted-bundle.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/runtime-state typecheck`
- `git diff --check` over the touched files

Not yet verified end-to-end: `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local` did not reach E2E execution because the runner-bundle build failed in unrelated package build errors. Rerun this once the active Cloudflare/assistant-runtime build work is green.
