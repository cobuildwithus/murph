# Reduce avoidable hosted container starts and allocation cost

Status: active
Created: 2026-09-22
Updated: 2026-09-22

## Goal

- Reduce unnecessary hosted container starts and allocated lifetime while preserving
  immediate replies, timely meaningful wearable updates, and retention deadlines.
- Develop a source-grounded architecture and cost model targeting at least a
  fifty-percent reduction; distinguish modeled savings from deployed proof.

## Success criteria

- Reproduce and fix proven defects with focused tests and relevant typechecks.
- Explain standby inventory separately from member-bound execution in cost models.
- Complete the requested parallel ReviewGPT architecture consultation and parent
  triage, then review the final candidate under the normal completion workflow.

## Scope

- In scope: container lifecycle and standby policy, transient-content retention
  scheduling, bounded device history work, webhook coalescing architecture.
- Out of scope: production mutations or deployments, delaying urgent workout or
  foreground work without an explicit freshness contract, deleting canonical data.

## Constraints

- Existing Web control facts, mailbox, connection dirty state, runtime retained
  jobs, and Temporal orchestration remain the sole owners at their boundaries.
- Keep production evidence in ephemeral diagnostic memory; use synthetic examples
  and source-grounded findings in repository artifacts and external review packets.
- Preserve all accepted work, write fences, revocation, checkpoint recovery, the
  conversation idle contract, and the maximum transient-content retention window.
- Keep the current two-vCPU instance size. Cost reductions must come from fewer
  avoidable starts, shorter allocation, or standby policy, without downsizing.

## Risks and mitigations

1. A container-day bill can include unclaimed standby time attributed to a later
   member. Separate allocation, binding, invocation, and destruction before
   labeling costs or diagnosing leaked work.
2. Fewer wakes could postpone useful data or indefinitely defer a busy queue.
   Preserve urgency bypass, bounded maximum latency, and checkpointed continuation.
3. Coalescing retention could extend privacy deadlines or discard live work.
   Retain exact accepted-input safety and never postpone the maximum deadline.

## Tasks

1. Independently investigate retention amplification, lifecycle attribution,
   device history work, and billing economics with scoped agents.
2. Ask ReviewGPT to inspect the attached source and propose a bounded cost-saving
   design and patches in parallel with local diagnosis.
3. Implement demonstrated defects at existing owners. Start with confirmed-empty
   daily history traversal, retaining current populated-day and retry behavior.
4. Evaluate architecture proposals against freshness, privacy, latency, and
   measurable cost; implement only justified scope.
5. Run focused proof/typechecks, parent review and complexity guard, document the
   stable contracts, and complete the scoped commit and applicable final review.

## Decisions

- The task uses one isolated checkout with disjoint agent edit ownership. Parent
  owns durable documentation, aggregate review, and commits.
- Initial cost-attribution hypotheses are diagnostic questions, not established
  container-lifetime defects.
- Architecture consultation is separate from the final candidate review gate.
- Confirmed-empty daily aggregate history now uses the existing bounded owner-unit
  traversal; exact-record modes retain their existing checkpoint boundaries.
- Finite retention checkpoints exclude unrelated canonical archives. The archive
  stage is one cohesive helper retaining its shared timeout and independent
  failure reporting; no retention eligibility changes are included.
- Unbound standby retention is intentional fixed-capacity policy, not evidence of
  a post-invocation leak. A smaller or disabled pool uses existing configuration
  and cold fallback. The current two-vCPU size remains fixed by user requirement.

- Duplicate completion notifications retain their exact pending match when the
  existing lifecycle guard yields to queued work, allowing the matching waiter to
  retry safe cleanup without weakening ownership, health, or warmth checks.
- Dense raw retention receives up to forty-five seconds within the remaining
  overall device-pass budget. Provider work no longer consumes that stage budget;
  truly exhausted passes retain their ordinary continuation.

## Product UX

- Outcome: fewer unnecessary background allocations with timely, correct data.
- Reaches: foreground conversations, new workouts/sleep, first connection and
  backfill, duplicate device updates, old transient content, and revoked members.
- Proof: source-owner regression journeys must preserve successful import and
  checkpoint progress, foreground preemption, privacy deadline, and recovery.
- Patch replay: Ready for the bounded history and retention corrections. Covered
  empty and populated dates, foreground interruption, original import identity,
  exact-record recovery, protected pending content, and ordinary archive behavior.
- Cleanup replay: Ready for duplicate callbacks before and after results, queued
  successors, active-child drain, conversation warmth, and remaining-pass budget.
- Broader architecture and rollout: Hold pending consultation and performance proof.
  The earlier downsizing scenario is excluded from the cost target.

## Verification

- Focused owner tests and package typechecks selected after each proven change.
- Parent full diff/privacy review, applicable documentation checks, and
  `pnpm complexity:diff` for authored TypeScript.
- No production saving is claimed until the separately authorized rollout has
  comparable billing and freshness observations.
- Device history: four focused provider suites passed 218 tests; package typecheck
  passed. The new empty-history regression failed before the correction and now
  completes twenty fetched days in two jobs with unchanged coverage.
- Retention: two focused runtime suites passed 71 tests; package typecheck passed.
  Both new regressions failed before correction, including a composed canonical
  shard preservation check. Ordinary idle archiving remains covered.
- Complexity guard passes after extracting the coherent archive stage and naming
  the precise-history checkpoint predicate; no ratchet exceptions were introduced.

- Container lifecycle: 282 focused tests passed; generated the ordinary local
  Prisma client to resolve the dependency preparation gap; Cloudflare typecheck
  then passed.
- Device retention budget: 173 maintenance/mailbox tests and package typecheck
  passed; four new budget cases failed before correction.
- Changelog: ten archive-rendering tests passed from the repository-root
  Vitest invocation. The documented package-directory command has an existing
  Frog report and fails discovery; no duplicate report was created.
- Parent diff/privacy checks and documentation drift passed. The complexity
  guard reduces idle-maintenance debt by ten with other changed-file debt flat.
