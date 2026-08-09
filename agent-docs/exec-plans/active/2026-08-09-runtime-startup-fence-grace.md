# Prevent concurrent hosted runtime startup across deploy versions

Status: active
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

1. Capture private production proof without persisting member identifiers.
2. Convert the dangerous prior-version behavior test into the desired bounded
   startup-grace regression and demonstrate it fails before the implementation
   change.
3. Remove the deploy-version-specific grace bypass and update owner docs.
4. Run focused tests, typecheck, and direct diff/code-path proof.
5. Commit and push a review candidate, open a PR, run CI plus preliminary and
   final ReviewGPT concurrently, resolve findings, and close the plan.

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

- Commands to run:
  - focused Vitest for the startup-fence cases in
    `apps/cloudflare/test/user-runner-alarm.test.ts`
  - `pnpm --dir apps/cloudflare typecheck`
  - `git diff --check`
  - exact-head GitHub Actions and required ReviewGPT gates
- Expected outcomes: fresh deploy-skewed fences return `retry_later` and remain
  authoritative, fences older than startup grace are replaced, and all checks
  pass without a persisted-state or deploy-contract change.
