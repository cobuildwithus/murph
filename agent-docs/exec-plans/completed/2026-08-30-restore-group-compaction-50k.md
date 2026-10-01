# Restore group idle compaction to 50k

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Restore authenticated group-chat idle compaction from 100,000 to 50,000
  context tokens while preserving the existing off-turn, abortable, fail-open
  maintenance path.
- Restore the earlier maintenance boundary for long-lived group sessions;
  provider-dollar savings remain an operational measurement, not a guaranteed
  outcome of the threshold alone.

## Success criteria

- Group idle compaction admits an exact 50,000-token thread and skips a thread
  below that boundary.
- The native Codex protocol journey cold-resumes both the 49,999-token skip path
  and the 50,000-token compact path with the task context intact.
- Personal idle compaction remains unchanged at 90,000 tokens.
- Focused Assistant Runtime and Assistant Engine tests and typechecks pass.
- Required exact-head review and CI gates pass before merge.
- Protected-main Cloudflare deployment and post-deploy smoke confirm rollout.

## Scope

- In scope: group threshold constant, explanatory comment, exact boundary tests,
  PR/merge, Cloudflare hosted-runner deployment, and bounded rollout proof.
- Out of scope: personal or automatic thresholds, compaction accounting,
  provider-cache configuration, model routing, schemas, prompts, tools, and
  user-facing copy.

## Constraints

- Technical constraints: keep the threshold below the 132,000-token automatic
  ceiling and preserve authenticated group classification and maintenance
  ownership.
- Product/process constraints: treat this as a Product UX Patch, use the
  isolated PR lane, required specialist and final ReviewGPT gates, exact-head
  CI, and the protected-main Cloudflare deployment workflow.

## Risks and mitigations

1. Risk: more group sessions incur standalone compaction usage before another
   turn arrives.
   Mitigation: production evidence showed four of five affected sessions
   continued for 17 to 51 turns; keep the change group-only and off-turn.
2. Risk: warm containers from the 100,000-token rollout temporarily retain the
   old boundary.
   Mitigation: mixed versions only change maintenance frequency; deploy through
   the canonical gradual rollout and verify the new version and smoke.
3. Risk: native compaction could lose task context across cold replacement.
   Mitigation: retain exact skip and compact cold-resume protocol journeys at
   49,999 and 50,000 tokens.

## Tasks

1. Restore the group threshold and update its explanatory comment.
2. Move deterministic exact-boundary and continuation tests to 49,999/50,000.
3. Run focused tests, typechecks, and final diff/privacy review.
4. Commit, push, open the PR, and complete required ReviewGPT and CI gates.
5. Merge, deploy hosted Cloudflare execution, verify rollout, and retire the
   worktree.

## Decisions

- Product UX Patch:
  - Outcome: long-lived group chats compact at the prior 50k maintenance
    boundary.
  - Reaches: authenticated group sessions during idle shutdown only.
  - Proof: exact boundary tests plus compact and skip cold-resume journeys.
- Keep the stronger group continuation coverage introduced with the 100k
  change, but retarget it to the restored boundary instead of deleting it.
- Changelog is not applicable because this changes invisible maintenance
  admission without adding or changing a member-facing capability or copy.

## Verification

- Commands to run:
  - Focused Assistant Runtime idle-maintenance test.
  - Focused Assistant Engine runtime-process boundary test.
  - Focused Assistant Engine scripted skip and compact continuation journeys.
  - Assistant Runtime and Assistant Engine typechecks.
  - `git diff --check` and privacy-safe parent final review.
- Expected outcomes: exact 49,999 skip and 50,000 compact admission, preserved
  task context after cold resume, unchanged personal threshold, and clean
  exact-head review, CI, merge, deployment, and smoke gates.
- Product UX walkthrough: `Ready`.
  - A long-lived authenticated group now compacts during idle shutdown at
    50,000 tokens and resumes with the preserved task context.
  - A group at 49,999 tokens skips compaction and still cold-resumes with the
    preserved task context.
  - Personal conversations keep the 90,000-token threshold; foreground turns,
    prompts, tools, routing, and visible replies are unchanged.
- Local results:
  - Assistant Runtime idle-maintenance test: passed, 34 tests.
  - Assistant Engine current-shape group boundary test: passed.
  - Assistant Engine scripted skip and compact cold-resume journeys: passed,
    two tests.
  - Assistant Runtime and Assistant Engine typechecks: passed.
  - `git diff --check`: passed.
  - Preliminary specialist review: accepted the evidence-wording finding and
    removed the unsupported exact-savings implication; no new A/B harness was
    added because existing production continuation data and exact boundary
    tests are sufficient for this restoration, while historical provider
    compact usage cannot be recovered exactly.
  - Final cross-cutting ReviewGPT round: passed with no findings.
  - Parent final review: passed. The full patch remains the smallest direct
    restoration, and the Product UX purpose remains `Ready`: exact 49,999 skip,
    exact 50,000 compact, preserved cold-resume task context, unchanged 90,000
    personal threshold, and no foreground or visible-reply change.
Completed: 2026-08-30
