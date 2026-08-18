# Restore Vercel build completion on Standard machines

Status: active
Created: 2026-08-18
Updated: 2026-08-18

## Goal

- Let a successful hosted Web production build return immediately after the
  package-build leader exits, while preserving whole-group termination for
  timed-out, cancelled, and failed commands so Vercel Standard builders can
  complete instead of waiting for the platform ceiling.

## Success criteria

- A configured deadline does not make a successful command reap or wait on a
  residual descendant process.
- Deadline, cancellation, and failed-command process-group cleanup remains
  targeted at the owned group and covered by the supervisor tests.
- Focused supervisor and production build-contract tests pass.
- The required direct-main acceptance gate passes on the final reconciled
  candidate.
- The landed production deployment reaches Vercel's completed state; Standard
  machine proof is captured when the project setting permits it.

## Scope

- In scope:
  - `scripts/run-with-host-verification-slot.mjs` success-path ownership.
  - A focused integration regression for a successful leader with a live
    same-group descendant.
- Out of scope:
  - Next.js compiler, cache, and heap-policy changes.
  - Vercel project machine-size configuration.
  - Changes to non-production deadline admission.

## Constraints

- Technical constraints:
  - Keep timeout and external-cancellation cleanup targeted at the exact
    detached process group created by the supervisor.
  - Preserve the successful command's exit status and shared-slot release.
- Product/process constraints:
  - Preserve unrelated primary-checkout work by implementing in the sanctioned
    task worktree.
  - Treat the build wrapper as a production deploy boundary and complete the
    routed reliability review and verification gates.

## Risks and mitigations

1. Risk: Skipping cleanup too broadly could leave failed build descendants
   running.
   Mitigation: Exempt only clean exit code zero; retain reaping for timeout,
   cancellation, signal, and nonzero exit paths.
2. Risk: A timing-only regression could pass without proving the descendant
   survived.
   Mitigation: Capture the exact descendant PID, assert it remains alive after
   the successful supervisor exit, then terminate that owned test process.

## Tasks

1. Add a failing clean-success residual-descendant regression.
2. Restrict post-exit process-group reaping to unsuccessful or forced exits.
3. Run focused syntax, supervisor, and production build-contract checks.
4. Complete the routed review, reconcile the exact candidate, and run
   `pnpm verify:acceptance` once for the direct-main attempt.
5. Land the exact commit on `main` and monitor the production deployment.

## Decisions

- Keep the existing 15-minute production deadline and cold-Webpack memory
  policy; live deployment evidence shows the application build itself completes
  comfortably within the Standard-machine window.
- Do not infer group liveness after a clean package-build exit as unfinished
  application compilation. Vercel owns residual platform process cleanup once
  the successful command returns.

## Verification

- Commands to run:
  - `node --check scripts/run-with-host-verification-slot.mjs`
  - `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/run-with-host-verification-slot.test.ts`
  - Focused hosted Web production build-contract tests selected from the
    current app test configuration.
  - `pnpm verify:acceptance`
- Expected outcomes:
  - The clean-success regression proves the wrapper exits without signaling its
    residual descendant.
  - Existing timeout and cancellation tests continue proving full group
    cleanup and their exact exit codes.
  - Production build scripts retain the intended Webpack, cache, heap, migration,
    and deadline contract.
