# Next 16.3 Turbopack preview proof

Status: active
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
  an exact task-branch commit, and one forced-cold Vercel preview deployment.
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
3. Push the task branch and create a forced-cold Vercel preview deployment.
4. Capture duration, phase timings, and memory/failure evidence; assess the
   remaining Next 16.3 build switches without enabling them implicitly.

## Decisions

- Keep persistent Turbopack build caching disabled until a cold build first
  proves that the compiler fits the Standard machine.

## Verification

- Focused Vitest for the production build-policy contract.
- Full `pnpm --dir apps/web build` using the shared production runner.
- Forced-cold Vercel preview inspection and build logs on the exact commit.
