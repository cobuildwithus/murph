# Cut eager contract schemas from Worker startup

Status: active
Created: 2026-10-05
Updated: 2026-10-05

## Goal

- Shrink the `murph-hosted` Worker's global-scope startup so a request that
  lands on a fresh isolate reaches its handler sooner. Production evidence:
  about one in five Web direct wakes spends ~680 ms before the Worker route
  runs, and 102 of 109 such requests were the isolate's first request.
  Cloudflare reports Worker startup at 294–590 ms (limit 1 s).
- Startup is dominated by eager zod schema construction from shared contract
  modules that the Worker imports for a few symbols. Stop evaluating those
  modules at Worker startup without changing any public contract.

## Success criteria

- The Worker bundle no longer contains `operator-config` vault CLI contracts or
  the assistant CLI contract module.
- Alternating local `wrangler check startup` profiles show a consistent
  startup CPU reduction versus `origin/main`.
- Public package exports and parsed contract behavior are unchanged; focused
  package tests and typechecks pass; exact-head CI is green.

## Scope

- In scope: moving small shared primitives into leaf modules with re-exports,
  type-only import corrections, and one startup-only sort comparator.
- Out of scope: Worker routing, runtime ownership/orchestration, Temporal,
  container runtime behavior, schema semantics, bundling configuration,
  splitting the Worker into multiple scripts, and production deployment.

## Constraints

- Technical constraints: preserve every existing export path and symbol
  identity (moved definitions are re-exported from their old modules); no new
  dependency, configuration, or state. One additive package export
  (`@murphai/operator-config/assistant-delivery-contracts`) lets cross-package
  Worker-path callers import the leaf through a public entrypoint.
- Product/process constraints: internal performance change; no member-visible
  behavior change. Production benefit needs a separate authorized deploy.

## Risks and mitigations

1. Risk: a moved schema changes identity or behavior for existing importers.
   Mitigation: move definitions verbatim and re-export from the original
   module; focused contract tests cover both import paths.
2. Risk: local startup profiles are noisy.
   Mitigation: alternate baseline/variant builds and compare paired medians.

## Tasks

1. [complete] Move `isoTimestampSchema` and `pathSchema` into an operator-config leaf.
2. [complete] Replace the startup-time `localeCompare` sort in vault-share.
3. [complete] Move the assistant delivery/media primitives the Worker graph
   needs out of `assistant-cli-contracts.ts` into a leaf, re-exported unchanged.
4. [abandoned] Move the sleep-session enums out of `contracts/src/zod.ts`.
5. [abandoned] Load the browser vault replica parser on first use.
6. [complete] Verify with bundle inputs, alternating startup profiles, focused
   tests, typechecks, and complexity diff; PR CI pending.

## Decisions

- Keep `select_target`, Web-side admission, and the Worker bundle layout
  unchanged; the measured cost is global-scope evaluation, not round trips.
- `contracts/src/zod.ts` and `health-commons.ts` stay in Worker startup. The
  Worker's browser vault replica parser needs `experimentOutcomeSchema`, whose
  dependency tree spans most of `zod.ts`. A first-use dynamic import made
  esbuild wrap the `@murphai/contracts` barrel itself; eager callers then
  initialized every barrel re-export, growing the bundle from ~3.5 MB to
  ~3.8 MB and slowing startup. Tasks 4 and 5 were reverted because the
  sleep-session leaf only mattered if `zod.ts` could leave startup.

## Verification

- Commands to run: focused vitest suites for operator-config, contracts,
  hosted-execution, query, assistant-engine, assistant-runtime, and
  apps/cloudflare touched areas; package typechecks; `pnpm complexity:diff`;
  alternating `wrangler check startup` profiles against `origin/main`.
- Expected outcomes: tests and typechecks pass; heavy contract modules absent
  from eager Worker startup; paired startup CPU reduction.
- Results: operator-config, assistant-runtime, assistant-engine,
  hosted-execution, and apps/cloudflare typechecks pass. Focused suites pass
  (operator-config 143, assistant-engine 131, assistant-runtime 27,
  hosted-execution 102). The Worker dry-run bundle drops from 3,511 KiB to
  3,466 KiB and contains neither CLI contract module. Ten alternating local
  `wrangler check startup` pairs against `origin/main`: all ten faster, median
  non-idle startup CPU 140.5 ms to 126 ms (median paired -14.5 ms, -10%).
  `pnpm complexity:diff` passes and reports the 12 functions as exact moves.
