# Retryable outbox wake preservation

## Goal

Prove whether a checkpoint-gated wake can strand retryable outbox work after an
assistant pass clears the scheduler projection, then fix the issue if it is
real.

Success criteria:

- A local hosted-runtime regression test reproduces the wake loss before the
  production fix.
- The fix preserves retryable outbox follow-up wakes without adding a second
  scheduler or widening durable state ownership.
- Focused assistant-runtime verification and required repo checks pass.
- The scoped branch is committed, pushed, and opened as a PR.

## Constraints

- Branch from the current hosted foreground-preemption PR head.
- Preserve foreground assistant priority over maintenance and outbox retry work.
- Keep the architecture simple: one runtime wake projection, no new scheduler,
  no new durable state owner, and no speculative abstractions.
- Preserve unrelated working-tree edits and active plans.
- Do not expose secrets, direct personal identifiers, local account names, or
  home-directory paths in committed files or handoff text.

## Approach

1. Inspect the hosted runtime wake projection, checkpoint gate, and outbox retry
   paths.
2. Add the smallest local end-to-end regression that demonstrates the stranded
   retryable outbox wake, if reachable.
3. Fix the root cause at the wake merge/projection boundary.
4. Run focused and required verification, completion audits, and local final
   review.
5. Commit, push, and open a PR.

## State

Ready for scoped commit and PR.

## Notes

- Triggered by a partial ReviewGPT finding: "Gated wakes after a checkpoint
  could leave retryable outbox wakes stranded if the assistant pass clears
  them."
- Reproduced locally with a hosted runtime entrypoint test: a retryable outbox
  wake staged behind the idle checkpoint was replaced by a later foreground
  pass returning `nextWakeAt: null`.
- Root cause was the projection merge preserving checkpoint-gated wakes only
  for non-`assistant` reasons; retryable outbox retries use the assistant lane.
- Verification passed:
  - Focused retryable outbox wake repro test.
  - Adjacent late-foreground/device-sync/stale-gate/consumed-alarm wake tests.
  - Full hosted runtime entrypoint suite.
  - Hosted runtime assistant phase suite.
  - `pnpm typecheck` after preparing clean-worktree runtime build artifacts.
  - `test:diff` for the assistant-runtime owner plus affected Cloudflare verify.
  - `pnpm test:smoke`.
  - `git diff --check`.
- Completion audits passed with no required follow-up:
  - `security-privacy-review`: no medium-or-higher findings.
  - `coverage-write`: no additional proof gap found.
  - `deep-review`: no actionable production bug found.
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
