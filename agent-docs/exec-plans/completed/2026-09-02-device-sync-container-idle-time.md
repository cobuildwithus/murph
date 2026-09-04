# Cut device-sync container idle time

Status: completed
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Reduce device-sync-attributable Cloudflare container-active time by at least
  50% without reducing Junction cadence or worsening user-visible sync latency.
- Implement only the two measured wait deletions: immediate successful
  completion-fence dispatch and safe terminal maintenance-container teardown.

## Success criteria

- A successful `retained_completion_fence` remains durable and provider-free but
  is due immediately rather than after the retry backoff.
- Terminal maintenance-only invocations reuse the existing lifecycle health,
  generation, active-job, warmth, and replacement-work proof and stop without
  waiting for the 60-second reevaluation timer.
- Immediate/near-term continuations, foreground work, active jobs, conversation
  warmth, uncertain health, and cleanup failures retain the existing safe path.
- Focused assistant-runtime and Cloudflare lifecycle tests, package typechecks,
  complexity guard, exact-head CI, and final ReviewGPT all pass.

## Scope

- In scope: hosted device-sync completion-fence timing, Cloudflare runner
  lifecycle reuse, targeted regression tests, and matching owner documentation.
- Out of scope: a separate model-free container class, container resizing,
  provider cadence changes, pass-limit changes, new queues/schedulers/state, and
  production deployment or configuration mutation.

## Constraints

- Technical constraints: preserve Temporal wake ownership, Web cadence/dirty
  ownership, checkpoint-before-cadence publication, mailbox identity, bounded
  at-least-once replay, foreground priority, and one lifecycle decision owner.
- Product/process constraints: use the exact current `origin/main` base, accept
  the ReviewGPT patch as intent rather than overwrite authority, keep the PR
  draft until local proof and candidate review are complete, and preserve all
  unrelated worktrees and active PRs.

## Risks and mitigations

1. Risk: eager teardown races a replacement invocation or destroys active work.
   Mitigation: reuse the existing lifecycle lock, interaction-generation fence,
   child health, active-operation checks, and timer fallback; add direct races.
2. Risk: an immediate completion fence loops, repeats provider work, or publishes
   cadence before durable checkpoint completion.
   Mitigation: preserve the empty-job/scheduler-suppression/checkpoint contract
   and prove one bounded successor plus failure recovery.
3. Risk: Worker/container rollout skew changes behavior during deployment.
   Mitigation: keep wire and persisted shapes unchanged, document warm-old-bundle
   behavior, and require an immediate container rollout with convergence proof.

## Tasks

1. Re-anchor the two paths and focused proof on current `origin/main`.
2. Ask ReviewGPT to implement a scoped patch with tests and documentation.
3. Inspect and apply the returned patch, accepting only behavior proven against
   the current lifecycle and device-sync durability contracts.
4. Run focused tests, package typechecks, complexity and diff checks.
5. Commit, push a draft PR, complete exact-head CI and final ReviewGPT, and merge
   only when the repository completion gates authorize it.

## Decisions

- Keep the per-user/full-container architecture unchanged in this task.
- Do not reduce Junction reconcile cadence; latency must be neutral or better.
- Reuse existing lifecycle and retry owners rather than adding a device-specific
  manager, shutdown mode, scheduler, or persisted marker.

## Verification

- Commands to run: focused Vitest files selected from the changed owners,
  `pnpm --dir packages/assistant-runtime typecheck`,
  `pnpm --dir apps/cloudflare typecheck`, `pnpm complexity:diff`, and
  `git diff --check`.
- Expected outcomes: immediate fence stays provider-free and checkpoint-gated;
  terminal maintenance stops eagerly; every suppressing race/fallback remains
  safe; changed packages typecheck; exact-head required CI and ReviewGPT pass.
Completed: 2026-09-02
