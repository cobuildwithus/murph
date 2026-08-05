# Next 16.3 Turbopack preview proof

Status: completed
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Determine whether the hosted Web application can return from the supported
  Webpack fallback to the default Next 16.3 Turbopack production builder on
  Vercel's Standard preview machine without exceeding its memory limit.

## Success criteria

- The exact committed preview candidate runs `next build` without `--webpack`.
- Focused build-policy tests and a complete local hosted Web build pass.
- A forced-cold Vercel preview reaches Ready, or its exact failure phase and
  memory evidence are captured without changing production.
- Other Next 16.3 switches are assessed separately and are not bundled into
  the cold-memory experiment without direct evidence.

## Scope

- In scope: the hosted Web production build runner, its focused contract test,
  one exact branch-only Vercel deployment allow, an exact task-branch commit,
  and one forced-cold Vercel preview deployment.
- Out of scope: production deployment, changing the Vercel machine tier,
  enabling persistent Turbopack build caching before the cold proof, TypeScript
  or lint-tool migration, and product behavior changes.

## Constraints

- Technical constraints: retain the proven 1 GiB Next parent / 3 GiB generated-
  contract TypeScript worker heap split and every existing preflight,
  migration, generation, route-validation, and trace check.
- Product/process constraints: preview only; preserve the preceding local
  build-critical-path commit as a separate ancestor; do not open a PR or
  deploy production as part of this experiment.

## Risks and mitigations

1. Risk: Turbopack again exceeds the Standard builder's 8 GB container limit.
   Mitigation: force a cold preview, inspect its logs and diagnostics, and keep
   the production project and `main` unchanged.
2. Risk: filesystem caching obscures cold-build memory behavior.
   Mitigation: retain `turbopackFileSystemCacheForBuild: false` for this first
   candidate and request a deployment without the existing Vercel build cache.

## Tasks

1. Change only the production Next invocation from explicit Webpack to default
   Next 16.3 Turbopack and update its focused policy assertion.
2. Run focused tests and the complete local hosted Web build, then inspect the
   exact diff and create a separate experimental commit.
3. Deploy the exact committed task branch through Vercel CLI and create a
   forced-cold preview deployment.
4. Capture duration, phase timings, and memory/failure evidence; assess the
   remaining Next 16.3 build switches without enabling them implicitly.

## Decisions

- Keep persistent Turbopack build caching disabled until a cold build first
  proves that the compiler fits the Standard machine.
- Keep the repository-wide preview catch-all disabled. Allow only the exact
  experimental branch because the first CLI deployment was blocked before a
  build started by the checked-in `git.deploymentEnabled` policy.
- Remove that exact branch allowance again after the proof so the experiment
  leaves the repository-wide preview policy unchanged.

## Outcome

- The default Next 16.3 production invocation used Turbopack and completed on
  Vercel's 4-core, 8 GB Standard preview machine. The deployment reached
  `READY`; no out-of-memory failure occurred. Vercel does not expose an exact
  peak-memory value in these build logs, so the proof is bounded to fitting
  within the machine limit rather than a precise peak.
- The forced-cold deployment explicitly reported that it skipped build cache.
  Dependency installation took 29.6 seconds, the prepared repository
  TypeScript check took about 22 seconds, Turbopack compilation took 91
  seconds, Next's generated-contract TypeScript phase took 54 seconds, and 233
  static pages took 10 seconds. Vercel reported the build output complete in
  about four minutes and finished deploying outputs about 45 seconds later.
- The approximately nine-minute CLI wall time included about three and a half
  minutes queued before Vercel assigned the build machine. It is not all build
  execution time.
- The preview generated Prisma Client once. Preview migrations were correctly
  skipped, while the production-only handoff remains available for main-branch
  production deploys.
- Persistent Turbopack filesystem caching remains disabled. No additional Next
  16.3 experiment was enabled as part of this proof.

## Verification

- Focused Vitest for the production build-policy contract.
- Full `pnpm --dir apps/web build` using the shared production runner.
- Forced-cold Vercel preview inspection and build logs on the exact commit.
Completed: 2026-08-05
