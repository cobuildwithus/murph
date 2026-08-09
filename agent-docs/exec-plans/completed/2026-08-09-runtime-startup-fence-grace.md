# Prevent concurrent hosted runtime startup across deploy versions

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Prevent a fresh prior-version hosted runtime start from losing its write fence
  during the cross-Durable-Object dispatch window and executing concurrently
  with a replacement generation.

## Success criteria

- Recent same-version, prior-version, and legacy-container runtime fences all
  retain the existing bounded startup grace after an exact no-child wake result.
- A no-child fence is still replaceable after startup grace elapses.
- Focused Cloudflare tests and typecheck pass, including a regression that fails
  against the previous immediate prior-version replacement behavior.
- Durable runtime ownership docs describe the corrected deploy-skew behavior.
- Exact-head CI and required ReviewGPT gates pass with no unresolved findings.

## Scope

- In scope: UserRunner runtime-fence replacement, its focused tests, and the
  durable hosted-runtime ownership contract.
- Out of scope: latency-alert presentation, runtime-log ingestion, persisted
  state changes, provider behavior, and broad runtime lifecycle redesign.

## Constraints

- Technical constraints: keep one write-fence source of truth; add no new state
  or service; preserve explicit post-abort background preemption; retain bounded
  recovery after the existing 30-second startup grace.
- Product/process constraints: preserve foreground replies and recovery rather
  than disabling execution; use an isolated PR worktree; keep production
  evidence private and summarized.

## Risks and mitigations

1. Risk: A genuinely dead deploy-skewed start takes longer to replace.
   Mitigation: retain the existing 30-second bound and prove replacement after
   that bound.
2. Risk: Applying grace to explicit, identity-confirmed abort paths could delay
   foreground priority work.
   Mitigation: leave the existing post-abort `preserveStartingFence: false`
   override unchanged.
3. Risk: The incident inference could be wrong.
   Mitigation: require independent trace, isolated runtime-log, deployment, and
   code-path evidence plus a focused failing regression before changing code.

## Tasks

1. Completed: captured private production proof without persisting member
   identifiers.
2. Completed: converted the dangerous prior-version behavior test into the desired bounded
   startup-grace regression and demonstrated it fails before the implementation
   change.
3. Completed: removed the deploy-version-specific grace bypass and updated
   owner docs.
4. Completed: ran focused tests, typecheck, and direct diff/code-path proof.
5. Completed: committed and pushed a review candidate, opened a PR, ran CI plus preliminary and
   final ReviewGPT concurrently, resolved findings, and closed the plan.

## Decisions

- Production evidence shows two lease generations executed and completed
  deliveries concurrently for one runtime. The dedicated runtime-log database
  was healthy; the earlier claim that logs were unavailable was incorrect.
- The current prior-version immediate-replacement path treats a point-in-time
  no-child response as conclusive even though the previous request can have
  confirmed its fence and still be between UserRunner confirmation and
  RunnerContainer operation registration. The simplest correction is to apply
  the existing startup grace uniformly.
- Do not add a dispatch marker or a new coordination state: the existing grace
  closes the observed race with a bounded recovery tradeoff.

## Verification

- Pre-fix regression: the two new recent-fence cases failed because the prior
  code returned replacement acceptance instead of `retry_later`.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  apps/cloudflare/test/user-runner-alarm.test.ts --no-coverage`: 115 passed.
- `pnpm --dir apps/cloudflare typecheck`: passed.
- `git diff --check`: passed.
- Direct production scenario evidence: two foreground runtime lease generations
  overlapped for one member; the bounded three-day trace query found no second
  affected member.
- Preliminary ReviewGPT: `SPECIALIST_OUTCOME: PASS`; product-experience and
  coverage evidence sufficient, no findings, no patch artifact.
- Final ReviewGPT round 1: `ROUND_OUTCOME: PASS`; no findings.
- Exact-head GitHub Actions on the reviewed candidate: all required checks
  passed. The final plan-archive-only head receives the normal CI rerun.
Completed: 2026-08-09
