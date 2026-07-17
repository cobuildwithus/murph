# Cold workspace generated-delivery remediation

Status: active
Created: 2026-07-16
Updated: 2026-07-16

## Goal

Activate safe cleanup for assistant-generated one-time delivery files so they do
not inflate later hosted cold restores, while preserving every active delivery
obligation and every user-owned vault file.

## Evidence

- The traced cold reply spent about 3.3 seconds starting the container, 3.7
  seconds restoring the workspace, 1.2 seconds staging, and 2.4 seconds starting
  the provider before the model turn.
- One already-terminal assistant-generated archive survived 19 checkpoints.
  Removing it reduced the representative encrypted snapshot by 56.3%, plain
  bytes by 19.2%, and comparable restore time from 3.629 to 2.491 seconds.
- ReviewGPT rejected the original generic `exports/assistant-deliveries/**`
  ownership claim because that path was legal pre-existing vault space and the
  change could delete or omit user data.
- PR #768 established the reader-compatible exact runtime ref before any writer
  can emit it.

## Success criteria

- Only `.runtime/operations/assistant/generated-deliveries/<filename>` is owned,
  with one direct safe filename and no recursive ownership.
- Initial delivery preparation may adopt and persist that exact runtime ref;
  ordinary vault refs keep their existing behavior and permissions.
- Active awaiting-approval, pending, sending, retryable, or confirmation-pending
  obligations retain their exact files across checkpoint and restart.
- At a quiescent checkpoint, terminal, orphaned, or fingerprint-changed owned
  files are removed only after the complete flat inventory and outbox state are
  trusted.
- Generic `exports/assistant-deliveries/**` data is never owned, deleted, or
  specially excluded from portable packages.
- Phase two deploys only after phase-one Worker traffic and runner fingerprints
  have converged, then passes CI, ReviewGPT, deploy smoke, and a 15-minute
  exact-version sanitized observation window.

## Scope

- In scope: writer activation, narrow runtime-file adoption and permissions,
  flat fail-closed residue cleanup, same-turn model/tool guidance, checkpoint
  telemetry, approval/restart E2E proof, durable docs, PR review, deployment, and
  post-deploy monitoring.
- Out of scope: Priority processing, provider-tier changes, container prewarming,
  snapshot format/encryption changes, generic archive cleanup, canonical health
  data deletion, queues, migrations, ownership registries, or new lifecycle
  services.

## Invariants

- Phase-one readers remain the rollback floor after any phase-two writer can
  persist the exact runtime ref.
- Runtime staging is allowed only when the same assistant turn establishes a
  delivery obligation and calls `send_vault_file`; prepare-now/maybe-later files
  remain durable and user-owned.
- Existing or durable files are never moved or copied into runtime staging.
- Model-shell creation cannot rely on ambient umask: exact runtime parents are
  tightened to `0700`, the exact regular file to `0600`, and symlinks or special
  files fail closed before reading or hashing.
- Cleanup validates the whole direct inventory before deleting anything, runs
  only at the existing quiescent idle-checkpoint seam, and emits aggregate-only
  counters.

## Tasks

1. Merge current main normally into PR #764 while preserving the immutable first
   reviewed head as an ancestor; resolve conflicts in favor of phase-one shared
   readers and the runtime-owned path.
2. Delete the unmerged completed-plan snapshot for the rejected generic-prefix
   mechanism and preserve the accepted ReviewGPT finding in the PR retrospective.
3. Add a narrow runtime-state helper to adopt an already-created assistant-runtime
   regular file with path, symlink, and permission revalidation.
4. Activate initial-send acceptance for the exact runtime ref and update same-turn
   guidance without broadening hidden-path acceptance.
5. Replace recursive generic-prefix cleanup with flat runtime-owned cleanup and
   preserve all active outbox states plus fail-closed untrusted inventory.
6. Preserve generic exports in snapshots/support bundles and add paired regression
   coverage for runtime staging versus ordinary vault data.
7. Strengthen the hosted approval/restart E2E to create and request the runtime
   file in one turn, checkpoint, destroy the container, approve, restore, and send
   exactly once.
8. Run owner tests/typechecks, coverage-write, required completion audits, focused
   hosted E2E, package/dependency/docs/privacy checks, and final diff verification.
9. Push the existing PR head, run CI and ReviewGPT round 2 concurrently, remediate
   accepted findings, merge, and deploy only after every gate passes.
10. Verify exact-version 100% traffic and managed-container fingerprint smoke,
    then observe sanitized aggregate production logs for 15 minutes.

## Risks and mitigations

1. Deleting an active attachment: protect every exact active descriptor and retain
   the entire inventory when outbox parsing or filesystem trust is incomplete.
2. Escaping the owned root: accept only the shared exact flat ref, reject symlinks
   and special entries, and revalidate immediately before hashing or removal.
3. Weak permissions from shell creation: adopt only the exact runtime ref through
   the runtime-state owner and prove mode tightening in tests.
4. Rolling back below a reader that understands persisted hidden refs: keep phase
   one as the documented rollback floor while any outbox/checkpoint can retain one.
5. Overclaiming the latency gain: report the measured roughly 1.1-second comparable
   restore improvement separately from remaining container, staging, provider
   startup, and model-turn latency.

## Review retrospective

- Original requirement: reclaim terminal one-time generated delivery artifacts to
  reduce cold workspace restore cost without touching user-owned data.
- Rejected mechanism: a generic public vault prefix, recursive deletion, and a
  path-specific support-bundle exclusion.
- Accepted High: pre-existing legal files under that public prefix could be
  deterministically deleted or omitted.
- Decision: continue the existing PR only after collapsing ownership into the
  existing assistant runtime owner with exact flat refs, reader-first rollout,
  permission adoption, and no migration, marker, registry, queue, or new owner.

## Verification record

- Pending implementation and final gates.

