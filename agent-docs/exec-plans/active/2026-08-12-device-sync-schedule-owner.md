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
- Provider-derived schedule changes still reach the Web control plane.
- Focused regression tests prove both ownership boundaries.
- The public changelog describes the member-visible reply-latency recovery
  without exposing private incident evidence or internal identifiers.
- Relevant package tests and typecheck pass, required exact-head CI is green,
  and the routed ReviewGPT gates return no unresolved findings.

## Scope

- In scope:
  - Hosted device-sync control-plane schedule projection.
  - Runtime-local queued-job wake preservation.
  - Focused tests and durable owner documentation.
- Out of scope:
  - New schedulers, queues, persisted state, or Web schema changes.
  - Provider retry policy and artifact-upload error classification owned by a
    separate active task.
  - R2 upload retry behavior; reducing the self-exciting snapshot load is the
    proven root correction for this incident.

## Constraints

- Technical constraints:
  - Web remains the canonical owner of provider reconciliation facts.
  - Runtime-local job continuation remains workspace-owned and preemptible.
  - Foreground conversation work retains priority over background sync.
- Product/process constraints:
  - Preserve accepted device-sync work and existing provider cadence.
  - Avoid overlapping the active artifact-retry task's production paths; keep
    the regression in a distinct reconciliation section of the shared test.

## Risks and mitigations

1. Risk: Removing the combined minimum could strand queued local work.
   Mitigation: Prove the runtime still returns the local queued-job wake while
   projecting only the provider deadline to Web.
2. Risk: Provider schedule updates could stop propagating.
   Mitigation: Cover a changed provider-owned deadline in the same focused
   control-plane test.
3. Risk: A mixed-version deployment could continue producing excess wakes.
   Mitigation: Keep the wire contract unchanged and deploy the runner change
   immediately; old runners drain without requiring a coordinated Web deploy.

## Tasks

1. Read the current runtime, Web authority, sweeper, and schedule contracts.
2. Add a focused failing regression for distinct provider and local-job wakes.
3. Remove the incorrect schedule collapse at the runtime-to-Web projection.
4. Update durable runtime/reliability documentation for the ownership rule.
5. Run focused tests, typecheck, parent diff review, PR CI, and ReviewGPT gates.

## Decisions

- Use the existing runtime-local wake computation for queued jobs; do not add a
  new state owner or callback.
- Preserve the existing Web control-plane payload shape and change only which
  already-owned deadline populates `nextReconcileAt`.

## Verification

- Commands to run:
  - Focused assistant-runtime Vitest coverage for the new schedule-owner test.
  - Assistant-runtime package typecheck.
  - Durable-doc drift check for the owner-contract update.
  - Required GitHub checks on the exact PR head.
- Expected outcomes:
  - The provider deadline remains unchanged when a local queued job wakes
    sooner, while the runtime's next wake still selects that local job.
  - A provider-derived schedule change is still sent to Web.
  - No new persisted state, dependency, scheduler, or queue is introduced.
