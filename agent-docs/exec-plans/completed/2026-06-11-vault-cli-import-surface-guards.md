# vault-cli import-surface and bundle-budget regression guards

## Problem

The June 2026 vault-cli latency regression (fixed in PR #131/#134) happened because the scoped lazy-loading architecture had an invariant — "the per-invocation hot path loads only a small module set" — with no enforcement. One static import (llms-normalizer → command manifest → every command module → ink/react/yoga WASM) silently defeated it for every invocation, and the cost was only visible in the hosted container. Static imports look free in review; their transitive cost is invisible and the graph only grows.

## Guards

1. **Import-surface contract** (`packages/cli`): a checked-in contract listing the packages the scoped hot path may resolve. A test runs representative scoped commands (`wearables day`, `meal totals`, `list`) as subprocesses with a `node:module` resolve hook, normalizes every resolved module to its owning package, and diffs the set against the contract. Adding anything to the hot path becomes an explicit reviewed contract edit; shrinking the contract ratchets the collapse.
2. **Bundle budgets** (`apps/cloudflare/scripts/runner-bundle/bundle-cli.ts`): assembly-time assertions on the esbuild metafile — entry-chunk byte budget and total-bundle byte budget with documented headroom — so graph creep in the real installed artifact fails the deploy build with a diffable input list. The existing forbidden-package input check stays. Parity probe durations are recorded in the assembly log (warn-only, never a hard timing assertion) for longitudinal trend visibility.

Deliberately NOT included: CI wall-time budget tests (noisy shared runners make them flake; a stable budget would be too loose to catch regressions of the observed size).

## Verification

- New tests green via `pnpm test:diff` over touched files.
- Contract generated from the actual measured graph (post-#131, ~60 modules scoped) and proven non-vacuous by temporarily re-introducing a forbidden import.
- `runner:bundle:assemble-only` green with budgets active against the real bundle.

## Status

Completed 2026-06-11; shipped stacked on PR #134.
