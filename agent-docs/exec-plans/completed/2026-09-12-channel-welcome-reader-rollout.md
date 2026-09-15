# Prepare channel welcome readers for ordered deployment

Status: completed
Created: 2026-09-12

## Outcome and owner

Preserve required welcome retries, exact destination authority, and contextual greeting behavior during the rollout of PR #3374. Web is automatically deployed after main merges; the protected Cloudflare workflow consumes public main. Therefore land and deploy the already-reviewed runtime consumer support before merging Web producers. No new runtime implementation, flag, persisted owner, dependency, schema, or deployment policy is introduced.

## Evidence and decisions

Existing consumers recognize only the legacy member-wide welcome key. Destination-scoped keys miss required-welcome retry and stale-delivery suppression. Their generic notification parser is insufficient compatibility proof. Extract the existing shared builders, runtime readers/callbacks and engine greeting paths, plus their tests, preserving independent changes already on main.

## Product UX

- Outcome: new and retained welcomes keep their authorized destination and retry behavior; prior conversation selects a bounded contextual greeting.
- Reaches: existing Web legacy-key traffic first; destination-scoped producers remain in PR #3374 until full runtime convergence.
- Proof: focused engine/runtime tests, package typechecks, parent preservation review, final review and exact-head CI; protected deployment smoke and native convergence before the producer merge.

## Tasks

1. Extract the six reviewed consumer source paths and eight corresponding tests; preserve current main changes.
2. Update the runtime owner contract, run focused verification, review and commit the prerequisite.
3. Package the prerequisite for final review and required exact-head CI.

Implementation completion covers the ready reader candidate. The same session owns subsequent merge/deploy monitoring through the normal release workflows; this plan does not attest a production deployment.

## Deployment

The new runtime supports current Web legacy keys and future destination keys. Keep all existing predeploy, smoke and observer gates; ordinary gradual rollout is acceptable only when full convergence is proven before producer exposure. After Web emits new keys, this consumer becomes the runtime rollback floor. No production member messages or manual data backfill are part of verification.

## Verification

The dependency build, 184 engine tests, 372 runtime tests, 27 shared builder tests, and all three package typechecks pass. Complexity and docs drift pass. Current-main notification and prompt changes were preserved through clean three-way patch application. No new product implementation was authored during extraction. Both real-Codex greeting directions pass on the local subscription with one request and one new greeting each; replay is silent. Parent reviewed both replies Ready. Final review and CI remain PR completion gates.
Updated: 2026-09-12
Completed: 2026-09-12
