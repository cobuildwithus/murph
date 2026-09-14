# Diagnose and shorten native rollout wait

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Goal

- Shorten deployment-time loss of ready standby inventory with the smallest
  maintainable change, preserving rollout admission and durable shutdown.

## Success criteria

- Prove the remaining wait from native rollout metadata and deployment phases.
- Verify the chosen correction locally, through ReviewGPT and exact-head CI,
  and against a protected production rollout. Measure rather than assume gains.

## Scope

- In scope: bounded private rollout diagnostics, then the evidenced bottleneck.
- Out of scope: new fleet architecture, relaxed checkpoint safety, unrelated work.

## Constraints

- Use protected hosted credentials; local diagnostics must remain secret-free.
- Keep production rows and identifiers out of repository artifacts.
- Preserve simple ownership and existing rollout/smoke gates.

## Risks and mitigations

1. Native behavior may differ from source configuration. Read the live grace
   value and per-step timestamps before choosing another fix.
2. Faster rollout settings may reduce safety. Preserve durable shutdown and
   exact-image admission; obtain review of any changed rollout policy.

## Tasks

1. Add and review a bounded GET-only inspector in the private operations owner.
2. Run it through the protected production workflow and identify the wait.
3. Implement the smallest correction with focused regression evidence.
4. Review, merge, deploy, and measure the actual availability interval.

## Decisions

- The deployed zero connection-age grace did not establish a speed improvement.
- Existing deployment logs combine native rollout and smoke phases; inspect
  provider step timestamps without launching another rollout for diagnosis.
- Private diagnostic PR #143 landed; its first protected read failed without
  emitting data. Follow-up #145 adds closed reasons and accepts optional provider
  metadata without inventing values. Follow-up #147 preserves bounded history
  and validated settings when history is unavailable. Protected readback succeeded;
  zero grace was applied but native replacement still dominated the wait.
- Investigate reusing exact old/new image-pair admission for pristine standby
  readiness and removing transition-only target suppression. This could keep
  inventory available without accelerating native replacement or adding state.
  Preserve the deployment smoke's independent proof of the exact candidate image:
  it currently obtains that guarantee through the stricter pristine check.

## Verification

- Product UX patch plan: Outcome — preserve prompt starts during service updates.
  Reaches — fresh authenticated conversation work; retained member bindings and
  background work keep their existing allocation and recovery paths.
  Proof — transition readiness and claim/recovery tests, exact candidate smoke
  rejection, then protected rollout with observed inventory and ingress behavior.
- Private diagnostics: focused Node tests and `pnpm verify`, both ReviewGPT gates
  alongside exact-head CI, then the protected read-only workflow.
- Runtime correction: 296 focused Cloudflare tests passed after updating the
  existing preparation response assertion for the additive image attestation.
  Cloudflare and Web typechecks, 10 changelog render tests, docs drift, and
  complexity guard passed. Existing changed-file complexity hotspots are unchanged.
- Recommendation: retain the existing target and use canonical whole-pair image
  admission. Added explicit fresh candidate attestation to preserve deployment
  proof; no new state owner, fleet, timer, or runtime call was introduced.
- Product UX: Ready for reviewed rollout; local composed standby and failure
  paths pass. Production availability and latency remain unmeasured for this fix.
- Required final ReviewGPT, exact-head CI, protected deployment, and bounded
  post-deploy evidence remain completion gates.
- Reused existing Frog entry 20260912202546-changelog-focused-test for the
  documented test command directory mismatch; root-invoked test passed.

## Implementation handoff

- Public PR #3418 owns final exact-head review, CI, merge, protected deployment,
  and live outcome evidence. Record those outcomes in its PR body; this archived
  implementation plan remains immutable. The original session owns completion.
Completed: 2026-09-13
