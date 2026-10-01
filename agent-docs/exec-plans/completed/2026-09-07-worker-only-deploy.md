# Preserve runner capacity during Worker-only deployment

Status: completed
Created: 2026-09-07
Updated: 2026-09-07

## Goal and invariants

Implement the public selector for compatible Worker coordination releases without
reserving another member fleet. Preserve every serving runner image, capacity, release identity and
in-flight invocation. Keep protected private deployment and exact live receipts.

## Evidence and ownership

The current deployment admits an inactive full-capacity fleet before Worker
activation. Account quota can reject this even for a Worker coordination patch.
The existing native admission owner already supports publication without a
container mutation when execution artifacts match. Extend that boundary with an
explicit Worker-only mode that retains the serving artifact across source changes.
Private Murph Cloud remains the deployment input and hosted credential owner.

## Design

- Derive the selected release and retained applications from live provider state.
- Admit only the existing bounded smoke application for the newly built artifact.
- Keep the selected runner and any existing prior namespace available; a pending
  candidate becomes retained history so later reuse still requires drain proof.
- Omit an absent inactive application from effective config and receipt.
- Run signed smoke, including actual selected-runner readiness, before declaring
  convergence. Preserve normal predeploy checks and private exact-state verification.
- Use only with compatible Worker/retained-runner contracts. New optional allocation
  diagnostics can be omitted by the retained runner while Worker logs remain useful.
- No quota changes, member capacity reduction, rollback, or new state owner.

## Implementation outcome

The public selector, effective application set, retained history and receipt
plumbing are implemented. A separate private workflow change exposes the option.
This plan closes the public implementation phase; external review, exact-head CI,
private integration and production deployment remain tracked in the PR and owning
session. No production rollout or live latency improvement is claimed here.

## Verification

Synthetic tests must prove unchanged selected identity and member capacity,
missing inactive application handling, preserved old namespace routing, bounded
smoke-only admission, single Worker activation, and truthful receipt coverage.
Validation passed: 111 tests across staging, deployment CLI/settings, image
preparation, native release provider and receipt suites; Cloudflare typecheck;
`pnpm complexity:diff` (no debt, changed-file maximum decreased from 20 to 19);
`git diff --check`. Parent review confirmed member applications cannot enter
native admission in explicit retention mode and receipts use the staged set.
Required external review, exact-head CI and production proof remain outstanding.
Completed: 2026-09-07
