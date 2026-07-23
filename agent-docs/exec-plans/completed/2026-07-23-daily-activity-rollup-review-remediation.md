# Remediate final review findings for daily activity rollups

Status: completed
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Remove unnecessary stored activity-title state that can make a valid
  wearable summary fail strict projection parsing.
- Make the current release a marker-preserving, marker-producing compatibility
  phase, and prove existing consented group snapshots can converge before a
  separate strict consumer relies on those markers.
- Keep the correction inside the existing query, projection, hosted-runtime,
  and operator owners without adding a queue, scheduler, migration registry, or
  second source of truth.

## Success criteria

- Valid source titles containing control whitespace cannot poison stored
  wearable summaries or repeat the failure after an ordinary projection
  rebuild.
- Direct and stored daily activity results retain equivalent public semantics
  without persisting title evidence that ranking or reconciliation does not
  use.
- Dormant hosted grantor workspaces have a bounded, operator-owned convergence
  path using the existing `runtime.maintenance-requested` wake.
- The compatibility release keeps legacy snapshots readable while Web,
  runner, and current snapshots converge; exact-marker rejection remains a
  small follow-up gated on aggregate drain proof.
- Focused regressions, required diff verification, CI, and the final ReviewGPT
  remediation round pass on the exact pushed head.

## Constraints

- Prefer deletion and one-way data flow.
- Reuse the existing Web mailbox append, Temporal wake, runtime maintenance,
  checkpoint, and share-projection paths.
- Keep Temporal pointer-only and Cloudflare execution-only.
- Do not add read-triggered cross-member fanout, a generic backfill service,
  polling, lifecycle flags, or another persisted rollout owner.
- Preserve unrelated work and keep production evidence aggregate and
  identifier-free.

## Tasks

1. Reproduce both review findings through exact code paths and focused tests or
   production-safe aggregate evidence before changing behavior.
2. Delete activity title from private stored evidence if the reproduction
   proves it is unnecessary and add direct/stored/rebuild parity coverage.
3. Split producer compatibility from strict consumption, then document the
   existing-owner rollout and dormant-workspace convergence proof.
4. Update current deployment documentation and the PR description with the
   exact producer/consumer order and operator completion proof.
5. Run focused and canonical verification, commit and push the scoped
   remediation, resolve CI, and obtain a final ReviewGPT pass.

## Evidence

- Final ReviewGPT round 1 reported one strict-codec failure path involving a
  multiline source title and one rollout gap for dormant, unmarked consented
  snapshots.
- The current runtime protocol already defines
  `runtime.maintenance-requested` as a bounded operator wake that reuses the
  normal restore, local maintenance, idle checkpoint, and workspace-version
  compare-and-swap path.
- The maintenance operator surface is intentionally bounded and is not a
  scheduler, queue, or generic admin framework.
- Stored activity metric titles do not participate in candidate identity,
  ranking, deduplication, or public title selection, so deleting them removes
  the strict-codec failure without replacing it with sanitization policy.
- The old Web parser accepts but discards unknown semantic markers. The
  compatibility release therefore deploys Web first, then its marker-producing
  runner, then refreshes the bounded current snapshot population through the
  existing maintenance surface.
- Focused tests prove multiline-title direct/stored/rebuild parity, optional
  marker preservation through the Web delivery boundary, legacy-compatible
  group reads, and a fresh system mailbox signal waking Temporal from its
  indefinite signal-only wait.
Completed: 2026-07-23
