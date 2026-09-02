# Converge stale default wake handoff to model-free owner

Status: completed
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Stop a hosted runtime from repeatedly selecting a default assistant pass when
  live foreground evaluation has already disproved the overdue default wake and
  the exact durable system frontier belongs to the model-free owner.
- Preserve genuine foreground/default priority while making the stale-projection
  handoff converge durably so model-free maintenance can run on the next pass.

## Success criteria

- A production-shaped two-cycle regression fails before the fix and passes after
  it: the first default pass publishes a projection-only checkpoint, and the
  following system-owner pass advances the durable model-free frontier.
- The handoff pass does not run assistant, provider, device, or system work under
  the wrong owner and does not increment the system progress generation.
- A genuinely due default wake still retains priority over model-free work.
- A running cron job with a past `nextRunAt` is not projected as new runnable
  default work.
- An earlier retained device-sync model-free wake survives both canonical
  runtime-status and generic idle checkpoints when the workspace scalar still
  names a later assistant wake; blocked assistant policy keeps its existing
  restoration path.
- A carried device-sync scalar does not request owner handoff by itself; fresh
  foreground work still runs unless live projection reconciliation explicitly
  requested the non-assistant handoff.
- Focused runtime tests, package typecheck, and required repository verification
  pass on the final diff.
- The exact normalized live incident facts replay without private identifiers,
  and the deployed runtime's durable frontier advances after shipment.

## Scope

- In scope:
  - Public assistant-runtime wake projection and checkpoint convergence.
  - Real runtime entrypoint and two-owner regression coverage.
  - Runtime protocol/reliability documentation and public changelog, if required.
- Out of scope:
  - Temporal priority-policy changes.
  - Cloudflare routing or fencing changes.
  - Dropping, consuming, or executing durable system rows during a default pass.
  - Persisting production identifiers or payloads in repository artifacts.

## Constraints

- Technical constraints:
  - Runtime owns assistant-timer semantics; Web persists projections, Temporal
    interprets them, and Cloudflare routes the selected mode.
  - Checkpointing must be replay-safe and must not claim application progress.
  - Status-read failure must fail closed and retain the existing projection.
- Product/process constraints:
  - Members with real foreground work must not be delayed by maintenance.
  - Members with only model-free backlog must eventually release default ownership.
  - Production facts may be used transiently for diagnosis but never committed.

## Product UX

- Effort: Patch.
- Outcome: Existing background follow-through no longer remains stuck behind an
  assistant timer whose live work has already ended.
- Reaches: The existing hosted journey where a stale projected assistant wake
  and due model-free connected-device work coincide.
- Proof: Replay the identifier-free production 0/4/4 boundary through the real
  runtime entrypoint, then confirm the affected production frontier advances
  after deployment.

### Walkthrough

- Member waiting on connected-device follow-through: the production-shaped
  default pass publishes the device owner without running device, provider, or
  model work under the wrong owner; the queue and handled frontier remain
  intact for the next pass. Ready.
- Member with a genuinely due conversation, reminder, pending delivery, or
  other default-owned task: live default-source checks retain priority, and
  checkpoint reconciliation preserves every future or due default source.
  Ready.
- Member whose live cron status cannot be read: the runtime does not declare
  the projection stale, so existing durable wake authority remains fail-closed.
  Ready.

No visible interface or copy changes. The public changelog describes the
recovered outcome without exposing runtime identifiers or private evidence.

## Risks and mitigations

1. Risk: Clearing a real due default wake lets maintenance run first.
   Mitigation: Reconcile only after the authoritative live preflight reports no
   runnable foreground/default work, with regressions for genuine due work.
2. Risk: A handoff checkpoint falsely advances the system frontier.
   Mitigation: Keep handled-through and progress generation unchanged; checkpoint
   only the corrected owner projections.
3. Risk: The fix handles device wakes but not other model-free frontier kinds.
   Mitigation: Key convergence to owner classification, not a device-specific kind.
4. Risk: An unrelated open change overlaps the assistant phase.
   Mitigation: Keep the patch narrowly owned, inspect the current-base merge tree,
   and use exact-head review and CI before merge.

## Tasks

1. Capture a private-data-free normalized replay envelope from the live incident
   and prove the current Temporal/runtime decision sequence.
2. Add the missing two-cycle production-shaped regression and record the pre-fix
   failure.
3. Implement the smallest runtime-owned projection-convergence checkpoint and
   normalize non-due cron projection timestamps.
4. Preserve all-owner arbitration at runtime-status checkpoints and retain
   device-sync ownership at the idle boundary, with independent regressions so
   one boundary cannot mask the other.
5. Gate generalized owner handoff on the projection-only checkpoint marker so a
   stale carried device token cannot suppress newly arrived foreground work.
6. Run focused tests, typecheck, static privacy inspection, and exact-fact replay.
7. Update durable contracts/changelog where the externally observable reliability
   guarantee changes.
8. Commit, open a draft PR, run exact-head ReviewGPT with CI, merge/deploy, and
   verify the affected runtime's durable frontier advances.

## Decisions

- Keep Temporal's default-before-model-free priority unchanged; current history
  replay proves it is following the documented contract.
- Use exact live facts only in transient in-memory replay. Commit a synthetic
  fixture with the same normalized owner/timer/frontier shape.
- Treat the first pass as a projection handoff, not application/system progress.

## Verification

- Commands to run:
  - Focused Vitest files for wake scheduling, real device frontier, and hosted
    runtime entrypoint convergence.
  - Assistant-runtime package typecheck.
  - Repository-required scoped verification and diff/privacy checks.
  - Identifier-free exact production-fact replay before and after the fix.
- Expected outcomes:
  - Pre-fix regression shows repeated default selection with no checkpoint.
  - Post-fix first pass durably removes/advances the stale default projection and
    publishes the model-free wake; second pass advances handled-through.
  - No assistant/provider/device execution occurs during the handoff checkpoint.
Completed: 2026-09-01
