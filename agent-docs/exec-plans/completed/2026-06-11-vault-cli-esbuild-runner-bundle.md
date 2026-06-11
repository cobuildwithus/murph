# vault-cli esbuild bundle in the hosted runner image

## Problem

Even after the import-hygiene fix (PR #131), every vault-cli invocation in the 1-vCPU runner container pays per-file module-loading overhead: ESM resolution, stat/open syscalls, and parse/compile across hundreds of small dist files. Container file I/O is far slower than a dev laptop (container node boot ~1.9s vs ~45ms locally), so this overhead dominates per-command latency there.

## Approach

Bundle the installed vault-cli at runner-bundle assembly time (CI, before docker build) with esbuild `--splitting`, which collapses ~700 module files into ~126 chunks while preserving the CLI's scoped lazy loading. Three correctness hazards discovered during prototyping, each handled structurally:

1. **Top-level-await poisons lazy chunks** (esbuild's async lazy-init for TLA-infected dynamic-import targets never settles → silent exit-0). Two sources found and removed: ink/yoga-layout (kept `external`, resolved from installed node_modules only on the lazy chat path) and `packages/runtime-state/src/sqlite.ts`'s `await import("node:sqlite")` (replaced with `process.getBuiltinModule("node:sqlite")`, which preserves the warning-filter-before-load ordering without TLA).
2. **tsconfig `paths` leak src**: esbuild auto-applies workspace tsconfig paths and bundles sibling packages' TypeScript sources instead of built dist. Neutralized with `tsconfigRaw: "{}"` (matches the runner bundle's real layout: installed tarballs, dist-only).
3. **`createRequire(import.meta.url)` + `require('../package.json')`**: chunks must sit one level under the package root, so the bundle dir is `node_modules/@murphai/cli/.bundle/`.

Silent-failure class is fenced by an assembly-time parity battery: bundled vs unbundled byte-identical output (stdout + exit status) for `--help`, `--llms`, `--llms-full --format json`, and two scoped probes (`wearables day`, `meal totals`) that exercise routing, loader-backed services, and lazy runtime imports. Divergence fails the assembly.

`NODE_COMPILE_CACHE` was evaluated and intentionally NOT shipped: it showed ~15-20% locally, but the 2026-06-10 in-container measurement (recorded in `apps/cloudflare/test/container-image-contract.test.ts`) found a baked compile cache to be a no-op — module *eval* dominates in the container, and the cache only skips parse/compile. Re-verified 2026-06-11 on this branch's assembled bundle in docker (`--cpus=1`, qemu amd64, runner base image): unbundled scoped 888ms → 885ms with warm cache (noise); split-bundle deltas also within qemu jitter. The contract test guards against reintroducing it.

## In-container measurements (docker --cpus=1, qemu amd64, runner base image, 3-run averages)

| Variant | scoped `wearables day` | full `--help` |
| --- | --- | --- |
| unbundled dist | 888ms | 1610ms |
| split bundle | 778ms (−12%) | 1190ms (−26%) |
| compile cache (either variant) | within noise | within noise |

## Changes

1. `packages/runtime-state/src/sqlite.ts` — TLA removal via `process.getBuiltinModule`.
2. `apps/cloudflare/scripts/runner-bundle/bundle-cli.ts` (new) — esbuild split bundle + parity battery + bin wrapper retarget; called from `assemble-runner-bundle.ts` after `rewriteRuntimeBinWrappers`.
3. `apps/cloudflare/scripts/runner-bundle/runtime-shape.ts` — export `buildPortableNodeBinWrapper`.
4. `apps/cloudflare/package.json` — `esbuild` devDependency (+ lockfile).

## Measured (local, user CPU; container gain expected mainly from fewer file opens/resolutions)

- scoped command: 0.28s unbundled → 0.28s split bundle (parity locally; container I/O is the target).
- full `--help`: 0.46s → 0.38s split bundle.
- single-file (non-split) bundling was measured SLOWER for scoped commands (0.43s — parses all 7MB every run) and rejected.
- Parity battery: all probes byte-identical.

## Verification

- Full local `runner:bundle:assemble-only` run with the new step (includes the parity battery against the real installed layout).
- Focused unit test for the bundle step.
- `pnpm test:diff` over touched files.

## Status

Completed 2026-06-11; shipped as PR #134 (stacked on PR #131).
