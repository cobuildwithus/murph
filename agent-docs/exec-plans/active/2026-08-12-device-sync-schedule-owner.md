# Separate hosted device sync schedule ownership

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Stop hosted device-sync continuation work from rewriting the Web-owned
  provider reconciliation deadline and re-entering the global due-reconcile
  sweep, so foreground replies no longer inherit avoidable snapshot churn and
  runner replacement latency.

## Success criteria

- A queued local device-sync job may keep an earlier runtime wake without
  shortening the provider account's canonical `nextReconcileAt` projection.
- A cold replacement re-admits the scheduled provider work from a separate Web
  recovery projection even though the machine-local job store is not snapshotted.
- Provider-derived schedule changes still reach the Web control plane.
- Focused regression tests prove both ownership boundaries.
- The public changelog describes the member-visible reply-latency recovery
  without exposing private incident evidence or internal identifiers.
- Relevant package tests and typecheck pass, required exact-head CI is green,
  and the routed ReviewGPT gates return no unresolved findings.

## Scope

- In scope:
  - Hosted device-sync control-plane schedule projection.
  - Runtime-local queued-job wake preservation and cold-replacement recovery.
  - A separate Web control-plane recovery projection and migration.
  - Focused tests and durable owner documentation.
- Out of scope:
  - New schedulers or queues.
  - Provider retry policy and artifact-upload error classification owned by a
    separate active task.
  - R2 upload retry behavior; reducing the self-exciting snapshot load is the
    proven root correction for this incident.

## Constraints

- Technical constraints:
  - Web remains the canonical owner of provider reconciliation facts.
  - Runtime-local job continuation remains job-store-owned and preemptible while
    Web retains only the minimum recovery projection required after store loss.
  - Foreground conversation work retains priority over background sync.
- Product/process constraints:
  - Preserve accepted device-sync work and existing provider cadence.
  - Avoid overlapping the active artifact-retry task's production paths; keep
    the regression in a distinct reconciliation section of the shared test.

## Risks and mitigations

1. Risk: Removing the combined minimum could strand queued local work after a
   cold replacement because the device-sync SQLite store is machine-local.
   Mitigation: Persist the wake separately, reconstruct scheduled provider work
   only when the local store has no account job, and cover the restore path.
2. Risk: Provider schedule updates could stop propagating.
   Mitigation: Cover a changed provider-owned deadline in the same focused
   control-plane test.
3. Risk: A mixed-version deployment could strand a recovery wake or continue
   producing excess global sweeps.
   Mitigation: Capability-gate the split, deploy Web first, and retain the
   legacy minimum projection whenever the capability is absent.

## Tasks

1. Read the current runtime, Web authority, sweeper, and schedule contracts.
2. Add a focused failing regression for distinct provider and local-job wakes.
3. Split provider cadence from cold-restore wake projection at the runtime-to-Web boundary.
4. Re-admit scheduled provider work from that projection only when the local job is absent.
5. Update durable runtime/reliability documentation for the ownership rule.
6. Run focused tests, typecheck, parent diff review, PR CI, and ReviewGPT gates.

## Decisions

- Use the existing runtime-local wake computation and provider scheduler; do not
  add a queue or another scheduler.
- Persist one nullable timestamp next to Web's existing connection schedule so
  cold restore can reconstruct work without making it a global sweep input.
- Capability-gate the new field and retain the legacy minimum projection against
  older Web deployments.

## Verification

- Commands to run:
  - Focused assistant-runtime Vitest coverage for the new schedule-owner test.
  - Assistant-runtime package typecheck.
  - Durable-doc drift check for the owner-contract update.
  - Required GitHub checks on the exact PR head.
- Expected outcomes:
  - The provider deadline remains unchanged when a local queued job wakes
    sooner, while the runtime's next wake still selects that local job.
  - A cold runtime with the recovery timestamp and no local job reconstructs
    scheduled provider work at that timestamp.
  - A provider-derived schedule change is still sent to Web.
  - No new dependency, scheduler, or queue is introduced.
