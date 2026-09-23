# Protect admitted runtime startup from idle cleanup

Status: active
Created: 2026-09-22
Updated: 2026-09-22

## Outcome and invariant

A warm member-bound container must survive the handoff from admitted startup to native invocation. Idle expiry may reclaim genuinely idle shells, but cannot infer absence of admitted work from an empty child or missing local invocation alone.

## Owner and evidence

Postgres runtime ownership is canonical before slot binding and across the separate readiness and launch RPCs. RunnerContainer owns native lifecycle and its existing scheduled cleanup. The reproduced gap is a bound pristine shell with no conversation receipt or local operation while its canonical owner is starting. The current cleanup treats that shell as idle.

## Design

Derive pending work from the existing runtime owner at the final idle-cleanup boundary. Use the existing bounded reconcile command for member-bound slots, preserving starting, active and retiring exact targets and failing closed on uncertainty. Run that read outside the existing lifecycle lock so arriving readiness does not wait; recheck the existing interaction generation under the lock before cleanup. Keep the existing lifecycle recheck as recovery; add no lease, timestamp, schema, timer or admission state. Normal invocation and explicit retirement remain unchanged.

A cleanup decision that precedes a new claim still uses existing native retirement and reconciliation. This change protects ownership already established before the cleanup read; it does not promise a warm shell after idle cleanup has already won. No production deployment or rollout-policy change is included. Platform rollouts can independently interrupt containers and are separate from this defect.

## Proof and compatibility

Exercise real binding, readiness, expiry and SQLite stores with synthetic native and control-plane boundaries. Cover startup before launch, reactivation, terminal idle cleanup, uncertainty and interactions during the control read. Run focused Cloudflare suites, typecheck and complexity review. No new wire operation or persistent format; old Web and warm runner bundles remain compatible. Required PR CI and final ReviewGPT follow focused proof.

## Tasks

1. Add a regression that fails on the existing cleanup path.
2. Add the canonical-owner guard and update the lifecycle owner documentation.
3. Verify, review, commit and open the scoped fix PR; complete required review gates.

## Verification

- Original code: seven new ownership cases failed, including both readiness-to-launch and reactivation startup regressions.
- Focused Cloudflare lifecycle, callback, supervision and Postgres processing suites: 359 tests pass.
- Cloudflare typecheck passes after local Prisma generation; the initial unprepared checkout lacked generated Prisma exports.
- Complexity diff passes: existing debt 67 and maximum 72 unchanged. Existing unrelated hotspots remain out of scope.
- Changelog production rendering: 10 tests pass from repository-root Vitest; the documented app-local command matches no files (existing Frog reports). Web typecheck and docs drift pass.
- Final ReviewGPT and required PR CI pending on PR #3664.

## Product UX

- Outcome: avoid destroying a ready session during admitted message handoff.
- Reaches: hosted member runtimes using immutable bound slots; platform rollout interruptions remain separate.
- Proof: real lifecycle/binding owners with synthetic native/control boundaries, including readiness completing while the control read remains unresolved. Delivery and assistant behavior are unchanged; production latency is not claimed from local tests.
