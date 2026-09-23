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
- Architecture consultation: complete. Keep two vCPUs and first remove avoidable
  allocation at existing lifecycle and inventory owners. Delayed admission remains
  a proposal pending a freshness decision and coordinated Temporal proof.
- Production rollout: Hold pending separate authorization and performance proof.
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
- Web typecheck passed after standard generated inputs; the final changelog
  fragment with this PR provenance passed all ten archive tests.

### Focused command inventory

- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/junction-blood-pressure-backfill.test.ts test/junction-provider-history.test.ts test/junction-provider-history-recovery.test.ts test/junction-provider-historical-fanout.test.ts --no-coverage`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-maintenance.test.ts test/hosted-runtime-mailbox-state.test.ts --no-coverage`
- The runtime idle-maintenance and workspace-entrypoint-retention suites cover
  the finite content-retention correction; the container and runtime-callback
  suites cover completion cleanup.
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir apps/web typecheck` (standard generation), then
  `pnpm --dir apps/web typecheck:prepared` after final fragment provenance.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx`

## Architecture outcome

1. Keep the current two-vCPU shape. Cloudflare bills active CPU separately from
   provisioned memory and disk, so reduce unnecessary allocated seconds first.
2. Retire unused pristine inventory through the existing off/zero-target path,
   subject to a separately authorized foreground latency and burst comparison.
   Preserve foreground admission and cold fallback. A ready-slot expiry that
   immediately refills the same target is not a capacity reduction.
3. Measure completion-to-stop intervals after both completion corrections, plus
   zero-work continuations and history traversal. Do not equate observed recovery
   tails with the proportion caused by one defect.
4. If more savings are needed, extend existing dirty-resource admission with a
   bounded delay for known routine daily totals. A fifteen-minute ceiling is a
   candidate product choice, not current behavior. Workouts, sleep, messages,
   explicit refresh/connect/backfill, revocation, and unknown hints stay immediate.
   Foreground work drains available dirty state.
5. An urgent arrival must advance and resignal a deferred or overdue batch even
   when it was already dirty. Derive urgency from every outstanding obligation;
   the latest event alone cannot erase earlier urgent work. Anchor a delay bound
   to first accepted receipt time, not provider occurrence time or the existing
   provider-derived firstDirtyAt field. Preserve revisions, payloads, independent
   retry/retention deadlines, and checkpoint-backed acknowledgement.
6. Implement any deferred-admission proposal together with the current external
   Temporal worker and replay/lost-signal/urgent-arrival proof. A second queue or
   scheduler is unnecessary. This PR does not implement that policy.
7. Exact per-record retention expirations are legitimate separate obligations.
   Leave eligibility and maximum deadlines unchanged. Earlier cleanup is a
   product contract change; shared pending-input terminality can abandon work,
   so neither a future clock nor a terminality call is a safe read-only shortcut.

For a fixed instance, model daily cost as allocated seconds multiplied by its
provisioned RAM/disk rate, plus active CPU seconds multiplied by the CPU rate.
Remove inventory, startup, and completion-tail time as disjoint categories;
apply each subsequent change to the remaining workload and subtract additional
probes, cold starts, and any longer execution. Compare equivalent traffic and
report freshness and foreground latency with billing. These formulas establish
a target, not a deployed percentage guarantee.

## Review evidence

- Architecture consultation completed with an attached full source snapshot and
  verified GPT-6 Pro response. Parent excludes downsizing and corrects the
  proposed deadline anchor to actual webhook receipt metadata.
- Final round one passed on 1844c2f9806f9a671925a04c33e417a8e827aea6. Verified
  exact attachment/head metadata, response model, completion marker, and roughly
  seven minutes of review. No accepted findings; exact-head CI also passed.
- The exploratory consultation separately identified completion deferrals that
  unnecessarily retain the ordinary recheck interval. Eight composed regressions
  reproduced it against the current candidate. Completion now prearms the existing
  one-second recheck before its unchanged generation/health guards; a fresh expiry
  proves idle or retains the ordinary recovery/receipt deadline. Source shrinks
  by five lines. The 290 lifecycle/callback tests, typecheck, and guards pass;
  round two reviews the complete five-correction candidate.
- Attachment retrieval failed an exact-response identity check twice while
  exact-thread export succeeded. Do not bypass that guard or claim an applied
  downloaded patch; independently verify the recommendation at its source owner.
