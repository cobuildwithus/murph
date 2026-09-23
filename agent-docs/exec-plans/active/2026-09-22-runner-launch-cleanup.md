# Protect admitted runtime startup from idle cleanup

Status: active
Created: 2026-09-22
Updated: 2026-09-22

## Outcome and invariant

A warm member-bound container must survive the handoff from admitted startup to native invocation. Idle expiry may reclaim genuinely idle shells, but cannot infer absence of admitted work from an empty child or missing local invocation alone.

## Owner and evidence

Postgres runtime ownership is canonical before slot binding and across the separate readiness and launch RPCs. RunnerContainer owns native lifecycle and its existing scheduled cleanup. The reproduced gap is a bound pristine shell with no conversation receipt or local operation while its canonical owner is starting. The current cleanup treats that shell as idle.

## Design

Derive pending work from the existing runtime owner at the final idle-cleanup boundary. Use the existing bounded reconcile command for member-bound slots, preserving starting, active and retiring exact targets and failing closed on uncertainty. Recheck the existing interaction generation after the await. Keep the existing lifecycle recheck as recovery; add no lease, timestamp, schema, timer or admission state. Normal invocation and explicit retirement remain unchanged.

A cleanup decision that precedes a new claim still uses existing native retirement and reconciliation. This change protects ownership already established before the cleanup read; it does not promise a warm shell after idle cleanup has already won. No production deployment or rollout-policy change is included. Platform rollouts can independently interrupt containers and are separate from this defect.

## Proof and compatibility

Exercise real binding, readiness, expiry and SQLite stores with synthetic native and control-plane boundaries. Cover startup before launch, reactivation, terminal idle cleanup, uncertainty and interactions during the control read. Run focused Cloudflare suites, typecheck and complexity review. No new wire operation or persistent format; old Web and warm runner bundles remain compatible. Required PR CI and final ReviewGPT follow focused proof.

## Tasks

1. Add a regression that fails on the existing cleanup path.
2. Add the canonical-owner guard and update the lifecycle owner documentation.
3. Verify, review, commit and open the scoped fix PR; complete required review gates.

## Verification

Pending.
