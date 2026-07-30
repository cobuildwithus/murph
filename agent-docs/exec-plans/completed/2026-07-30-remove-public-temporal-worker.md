# Remove Public Temporal Worker Implementation

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Finish the Murph Cloud repository migration by removing the temporary public
  Temporal worker rollback copy after the private worker and guarded deployment
  path are proven in production.

## Success criteria

- Public Murph contains the released orchestration contracts and hosted-local
  integration harness, but no Temporal Worker, Workflow, Activity, or production
  bundle implementation.
- Public local development fails clearly or disables Temporal when no external
  worker package is configured, while the sibling Murph Cloud path remains one
  supported command.
- Public workspace, typecheck, coverage, release, architecture, and CI
  configuration no longer references the deleted package.
- Durable docs identify private `cobuildwithus/murph-cloud` as the sole worker
  implementation and production deployment owner.
- Murph Cloud owns the full hosted E2E matrix and Cloudflare predeploy checks
  that require the private worker, while public CI retains only proof it can run
  without private source.
- Murph Cloud's cross-repository integration check and the remaining public
  exact-head CI pass against the final public boundary.

## Scope

- In scope:
  - Delete `packages/hosted-orchestrator-temporal`.
  - Remove public workspace, TypeScript, Vitest, release, and verification
    references owned only by that package.
  - Keep the public hosted-local harness external-worker seam and update its
    default/missing-worker behavior and focused tests.
  - Move hosted E2E and Cloudflare deployment checks that execute the real
    worker into Murph Cloud before deleting the public package.
  - Update public required-check ownership so a public commit is not required to
    run private implementation code.
  - Update current architecture, verification, testing, and ownership docs.
- Out of scope:
  - Temporal Workflow, Activity, signal, schedule, task-queue, retry, or
    history behavior changes in Murph Cloud.
  - Render service, environment, instance-count, or secret changes.
  - Removing public transport-neutral orchestration contracts, web signal
    clients, Cloudflare execution adapters, or hosted-local E2E scenarios.

## Constraints

- Preserve the live private Render worker, both instances, Temporal identities,
  current histories, and rollback through Render's previous private deployment.
- Do not copy, print, or persist production secret values.
- Do not reintroduce a public deploy owner or make public Murph depend on a
  private registry package.
- Keep the solution deletion-first: one external package-directory seam, no
  submodule, mirror, Git dependency, second scheduler, or compatibility service.

## Risks and mitigations

1. Risk: Public local development still assumes the deleted in-repo worker.
   Mitigation: Make missing external-worker configuration explicit and cover
   default, disabled, and sibling-path startup behavior.
2. Risk: Removing package tests also removes proof of public contracts.
   Mitigation: Retain contract, web, Cloudflare, hosted-local, and
   cross-repository Temporal E2E coverage; move only implementation-owned proof
   to Murph Cloud.
3. Risk: Production needs the public source rollback after deletion.
   Mitigation: Merge only after the private deploy path is proven end to end and
   the private prior deployment remains available as Render rollback.
4. Risk: Deleting the package first breaks every hosted E2E lane and the
   Cloudflare predeploy gate because hosted-local starts the real worker.
   Mitigation: Land and prove the private hosted E2E and Cloudflare deployment
   owners before changing the public workspace or required checks.
5. Risk: A public pull request cannot safely execute confidential worker source.
   Mitigation: Keep public PR checks limited to public contracts and harness
   behavior; run full cross-repository integration from the private trust
   boundary against selected public refs and current public `main`.

## Tasks

- [x] Inventory all public package, workspace, CI, release, guard, and documentation
   references and classify them as delete, retain, or redirect.
- [x] Land and prove Murph Cloud's full hosted E2E matrix against current public
   `main`.
- [x] Move Cloudflare deployment and its real-worker predeploy scenarios into Murph
   Cloud, initially deploy-disabled, then prove the private owner and retire the
   public deploy owner without changing production resources or identities.
- [x] Update public required checks and CI so public changes retain contract and
   harness proof without requiring confidential worker source.
- [x] Delete the public worker package and remove implementation-owned workspace
   wiring.
- [x] Update the hosted-local external-worker contract and focused tests.
- [x] Update guards and durable ownership/testing documentation.
- [x] Run focused local proof and the private cross-repository integration check.
- [x] Publish the cleanup draft PR, run preliminary ReviewGPT, resolve its
   findings, complete the parent final review, and prove exact-head CI.
- [x] Complete the three-hour production reply soak and close the implementation
   plan. Final ReviewGPT, merge, and task-worktree retirement remain the
   post-plan PR release gates required by the completion workflow.

## Decisions

- Murph Cloud is the sole implementation and deployment owner.
- Public Murph retains only transport-neutral contracts and integration seams.
- Existing private Render deployments, not public source, are the rollback path
  after this cleanup lands.
- Full worker-backed E2E and Cloudflare deployment belong on the same private
  trust boundary as the worker; public CI must not receive private source or a
  credential that exposes it.
- The private exact-ref integration matrix passed against the first public PR
  head before the obsolete public hosted-E2E required contexts were retired.
- Preliminary review findings are resolved at their owners: top-level
  hosted-local startup now validates the external worker before side effects,
  and test-owned Temporal connections close after each signal/query helper.
- All seven production reply checkpoints received replies. One delivered
  checkpoint was delayed by the exhausted usage allowance and recovered after
  the allowance was refilled; the fresh final checkpoint then passed normally.
  No runtime or deployment correction was required.

## Verification

- Focused hosted-local harness tests covering missing/default/external worker
  behavior.
- `pnpm hosted-temporal:guard`
- `pnpm docs:drift`
- `pnpm test:diff` over the changed workspace/config/guard paths when it remains
  the smallest truthful local proof.
- Murph Cloud `Public Murph Integration` against the public PR head.
- Full required public GitHub Actions and ReviewGPT gates on the exact PR head.
- Corrected-head Murph Cloud integration passed all 11 scenario legs plus the
  Temporal orchestration aggregator.
- Corrected-head public required checks passed.
- Seven production message checkpoints across three hours were sent and
  delivered without provider errors and received replies; the final post-refill
  checkpoint completed normally.
Completed: 2026-07-30
