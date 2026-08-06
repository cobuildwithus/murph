# Hosted runner bounded Zod startup

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Remove unused Zod locale modules from the hosted runner's statically
  evaluated boot closure through a typed public package boundary.
- Preserve every current schema, parser, and type behavior while reducing cold
  process import/evaluation work.
- Re-profile the reduced graph and identify the next evidence-backed lazy-load
  candidates without mixing unrelated runtime changes into this PR.

## Root-cause evidence

- The hosted runner static boot closure is approximately 8.44 MB; no single
  workspace package owns that total.
- A CPU profile attributes a dominant startup chunk to Zod plus contracts, and
  the current namespace-style Zod surface retains all locale modules.
- A controlled locale-free counterfactual reduced the static closure by about
  407 KB and improved paired native fresh-process median readiness from about
  1,020 ms to 859 ms. This is directional evidence until implemented and
  verified through the real package graph.
- Marking the five largest first-party packages side-effect-free saved only
  about 35 KB, so broad barrel cleanup is not a proportional solution.
- Removing code splitting and exposing health before loading the required graph
  were previously benchmarked and rejected because they shifted or increased
  accepted-to-provider latency.

## Success criteria

- Hosted boot code imports Zod only through one typed public owner surface.
- The production static boot closure retains only Zod's default English locale;
  the locale catalog and every non-English locale stay out of the graph.
- Existing schema runtime behavior and TypeScript inference remain intact.
- Focused package/app tests, typechecks, bundle proof, and fresh-process timing
  pass on the implementation.
- Follow-up lazy-load opportunities are supported by emitted-byte and call-path
  evidence and stay outside this PR unless required for correctness.

## Scope

- The owning contracts/package boundary for the narrowed Zod runtime surface.
- Hosted runner startup-graph imports and focused regression tests.
- Secret-safe bundle and startup measurement scaffolding when an existing test
  owner cannot express the invariant.
- Documentation only where a durable public package or boot-path contract
  changes.

## Constraints

- No dependency addition, bundler source rewrite, alias hack, second schema
  owner, persisted state, queue, or lifecycle manager.
- Preserve foreground reply priority and the current health/readiness meaning.
- Do not remove query-cache contents or move required provider work behind a
  misleading readiness signal.
- Keep unrelated lazy-load experiments as measured follow-up recommendations.

## Tasks

1. [x] Reproduce the current locale contribution and map the exact Zod runtime
   and type surface used by the hosted boot closure.
2. [x] Implement the smallest typed catalog-free public surface and migrate the
   affected startup graph.
3. [x] Add compatibility and bundle-regression coverage, then run focused
   type, test, bundle, fresh-process, and Docker proof.
4. [x] Profile the reduced graph and document ranked lazy-loading follow-ups.
5. [ ] Complete exact-head CI, ReviewGPT gates, parent final review, plan
   closure, and PR handoff.

## Verification log

- Production runner assembly: entry 1,729,632 B; static closure 8,182,922 B;
  total 9,862,735 B. Against the clean baseline, the static closure is 413,321 B
  smaller and total output is 419,819 B smaller.
- Zod contribution: 172,367 B with only `v4/locales/en.js`, down from 538,131 B
  and the 53-module locale catalog.
- Twenty alternating native samples per arm: baseline/candidate p50
  241.3/234.0 ms and p90 245.0/239.6 ms; paired median delta -8.7 ms.
- Ten alternating Docker samples per arm under amd64 emulation:
  baseline/candidate p50 1,197/1,189 ms and p90 1,460/1,491 ms. The paired
  images use the same base and Dockerfile; the candidate `/app/dist-bundled`
  tree is 420 KiB smaller and the image is 82,112 B smaller. Treat the timing as
  emulator/runtime noise, not as evidence of a material Docker speedup.
- Focused contracts and Cloudflare bundle tests pass. Every changed package,
  Cloudflare, and Web typecheck passes.
- Diff-aware verification exposed six stale Assistant Runtime expectations from
  the current base's newly normalized `sessionId: null` field; the same failures
  reproduce on the untouched base. The expected records now include that
  canonical field so the base contract and tests agree.
- The same lane exposed one stale CLI assertion from the current base's new
  system-authored resume rule. The untouched base reproduces it; the test now
  proves that a missing actor preserves the saved participant binding.
- Reduced-graph profile ranks dynamic-tool catalog/parser/execution separation
  first (251,039 B currently static), followed by wake-kind-specific event
  handlers (roughly 44 KB directly attributable) and post-turn idle maintenance
  (roughly 16 KB directly attributable).
