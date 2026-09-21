# Preserve hosted device source identity across cold restores

Status: active
Created: 2026-09-20
Updated: 2026-09-20

## Outcome and scope

Prevent repeated Junction imports from acquiring a new source identity after a
cold restore. This first delivery isolates source identity; history work and
scheduled wake reduction continue separately.

Outcome: stable hosted source provenance across container restarts.
Reaches: existing and legacy hosted Junction sources, local-only accounts,
warm hydration, and source lifecycle admission.
Proof: two fresh SQLite stores hydrate identical hosted source keys while local
account ids differ; runtime source-state and disconnect regressions remain green.

## Evidence and design

The source store canonicalized new Junction keys with the temporary local account
id. Read the existing hosted connection marker in the same transaction and retain
the supplied hosted key. Keep slug normalization and established identity merging.
No new state, schema, dependency, repair job, or canonical writer is needed.

## Protected invariants and rollout

Preserve local-only deterministic keys, warm identity, source lifecycle epochs,
and Web admission checks. Existing canonical records remain untouched. The wire
format is unchanged; deploy the runtime fix normally. An old runtime remains
compatible but can reproduce the defect until replaced.

## Tasks and evidence

- [x] Reproduce and fix the source store boundary.
- [x] Add repeated cold-store regression proof and update runtime expectations.
- [ ] Complete focused tests, typecheck, changelog and candidate review.
- [ ] Exact-head CI and ReviewGPT, then authorized merge and deployment.
