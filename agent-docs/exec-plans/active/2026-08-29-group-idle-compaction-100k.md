# Raise group idle compaction threshold to 100k

Status: active
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Raise authenticated group-chat idle compaction from 50,000 to 100,000
  context tokens while preserving the existing off-turn, abortable, fail-open
  maintenance path.
- Reduce repeated maintenance usage and member allowance drawdown in active
  group rooms without removing the 132,000-token automatic safety ceiling.

## Success criteria

- Group idle compaction admits an exact 100,000-token thread and skips a thread
  below that boundary.
- Personal idle compaction remains unchanged at 90,000 tokens.
- Focused Assistant Runtime and real app-server protocol tests pass, along with
  both affected package typechecks.
- Required exact-head review and CI gates pass before merge.
- The canonical Cloudflare hosted-execution workflow deploys merged `main`, and
  post-deploy version/smoke evidence confirms rollout.

## Scope

- In scope: the group threshold constant, its explanatory comment, exact
  boundary coverage, PR/merge, Cloudflare hosted-runner deployment, and bounded
  post-deploy verification.
- Out of scope: personal or automatic thresholds, compaction accounting,
  provider-cache configuration, per-room overrides, schemas, prompts, tools,
  and user-facing copy.

## Constraints

- Technical constraints: keep the group threshold below the 132,000-token
  automatic ceiling; preserve authenticated group classification and existing
  maintenance ownership.
- Product/process constraints: treat this as a small Product UX Patch for group
  members affected by allowance depletion; use an isolated PR lane, required
  completion-specialist and final ReviewGPT gates, exact-head CI, and the
  protected-main Cloudflare deploy workflow.

## Risks and mitigations

1. Risk: a higher threshold can increase the first cold request cost after a
   long idle because GPT-5.6 cache entries have a 30-minute minimum lifetime.
   Mitigation: retain compaction at 100,000 tokens, below automatic compaction,
   rather than disabling it; compare production compaction frequency and room
   usage after rollout.
2. Risk: warm containers from the prior rollout can temporarily retain 50,000.
   Mitigation: the skew changes only maintenance frequency and is safe; deploy
   through the canonical gradual rollout and verify the new version/smoke.
3. Risk: Murph currently estimates standalone compact usage rather than
   receiving exact cached/output usage from Codex.
   Mitigation: do not change accounting in this PR and avoid claiming exact
   provider savings; evaluate the threshold as a bounded operational change.

## Tasks

1. Verify the historical 100k/60k/50k rationale, current OpenAI cache contract,
   current pinned Codex cache-key behavior, and room-specific production cache
   behavior.
2. Update the group threshold and explanatory comment.
3. Update deterministic exact-boundary tests, including the real Codex
   app-server protocol harness.
4. Run focused tests, typechecks, and diff/privacy review.
5. Commit, push, open the PR, run required ReviewGPT and CI gates, and resolve
   any accepted findings.
6. Merge, deploy hosted Cloudflare execution, and verify live rollout evidence.

## Decisions

- Restore the original 100,000-token group threshold instead of disabling idle
  compaction. Current production data confirms cache reuse falls sharply after
  long idle gaps, while this room's 50k policy compacted unusually often.
- Keep the patch narrow; exact compaction-usage propagation is a separate
  accounting/observability concern.
- No changelog entry: this changes invisible maintenance admission and does not
  add or alter member-facing capability or copy.

## Verification

- Focused Assistant Runtime idle-maintenance test: passed, 34 tests.
- Focused Assistant Engine group compaction boundary protocol test: passed.
- Real pinned-Codex group compaction and cold-resume journey: passed; the
  resumed synthetic reply preserved every required task sentinel.
- Assistant Runtime and Assistant Engine typechecks: passed.
- `git diff --check`: passed; privacy-safe final diff inspection remains part
  of the parent final review.
- Required exact-head GitHub Actions and ReviewGPT results.
- Protected-main Cloudflare deploy workflow plus deployed version and smoke
  evidence.
