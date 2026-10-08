---
title: 'Direct assistant-runtime entrypoint test runs fail without a prior package build'
severity: 'minor'
---

## Expected Behavior

Running a single assistant-runtime entrypoint test file directly with `vitest run` should either pass on an unchanged base or fail fast with a message saying the package `dist` build is missing.

## Current Behavior

In a fresh worktree (frozen lockfile installed, no `packages/assistant-runtime/dist`), five cases in `test/hosted-runtime-workspace-entrypoint-foreground-input.test.ts` fail on unchanged base 138cf8303d. Three time out at about 5 seconds waiting for a `vault-share.deliver` event; two fail strict-equal assertions. That looks like a product regression. After `pnpm --dir packages/assistant-runtime build` (which `pnpm test` and `pnpm test:diff` run first), all 20 cases pass.

## Possible Solution

Have the vault-share/projection harness assert that the built artifacts it loads exist and fail with a "run pnpm build first" message, or have the direct Vitest config build or resolve them from source. The pending system-preemption entry (20261007124010) reports similar projection-boundary timeouts on an unchanged base and may share this cause.

## Minimal Reproducible Example

From a fresh checkout of base 138cf8303d with the frozen lockfile installed and no assistant-runtime `dist`:

```sh
pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-entrypoint-foreground-input.test.ts
```

Five of 20 tests fail. Run `pnpm --dir packages/assistant-runtime build` and repeat: 20 of 20 pass. No production data or services are required.

## Context

Hit while validating a latency-trace ordering change. The misleading timeouts first read as a base regression and cost a stash/rerun cycle before the build dependency was found.
