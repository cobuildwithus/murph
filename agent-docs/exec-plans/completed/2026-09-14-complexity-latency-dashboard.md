# Consolidate latency interval validation

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Outcome and invariant

Reduce latency dashboard aggregation complexity by sharing negative interval validation and observed-duration collection. Preserve null handling, nonnegative admission, NaN comparison behavior, per-row quality counters, percentiles, limits and query scope.

## Design

Introduce two private number-only helpers for repeated interval predicates and collection. Keep ingress-stage-specific rules and quality counter ownership in the dashboard loop. No query, transaction, timing-log read, row limit or public result shape changes.

## Verification

Run the existing latency store dashboard and alert tests, Web typecheck, complexity guard, direct numerical equivalence and candidate privacy review. Publish a scoped PR and begin ReviewGPT concurrently with exact-head CI.

## Results

Dashboard complexity 111 → 89; file debt 91 → 69. Both private interval helpers stay below 20. All 86 latency store and alert monitor tests passed. Web typecheck and complexity guard passed. Numerical admission and collection matched the original predicates over 81 endpoint pairs including null, NaN, infinities, negative, zero and positive values.

Candidate review confirmed database query, row bounds, timing-log scope, stage-specific validation, quality counters and public projections remain unchanged. The shared release-check fixture blocker is recorded in the task's Frog entry. ReviewGPT and exact-head CI remain external gates after publication.

## Repository investigation

Scanned all 3,333 authored JavaScript/TypeScript paths selected by the repository's ESLint-classic analyzer, excluding test/generated/dependency paths under its existing policy. The baseline contains 855 functions above 20, with zero parse failures. No tracked Swift, Kotlin, Rust or Go files are present; shell and Python utilities are outside this analyzer's comparable scoring scope.

Selected the ten highest-scoring distinct files so each PR has an independent source owner. All ten original hotspot functions remain above the threshold after these bounded changes; this work reduces their complexity without claiming the remaining debt is eliminated.

| Area | Hotspot | Before | After |
| --- | --- | ---: | ---: |
| Runtime entrypoint | Invocation coordinator | 251 | 233 |
| Assistant engine | Dynamic tool dispatcher | 189 | 139 |
| Local harness | Stack startup | 139 | 123 |
| Assistant engine | Route planning | 129 | 109 |
| Web settings | Billing settings | 128 | 91 |
| Runtime assistant phase | Phase coordinator | 128 | 112 |
| Workspace tooling | Import policy | 126 | 54 |
| Container | HTTP request callback | 125 | 113 |
| Web settings | Family manager | 121 | 86 |
| Web operations | Latency dashboard | 111 | 89 |

The ten target function scores total 1,447 before and 1,149 after (298 fewer decision points). Total excess-over-20 debt in the affected files also falls by 298; every newly introduced function remains at or below 20.

Baseline hotspot counts by source area:

| Area | Functions above 20 |
| --- | ---: |
| `apps/web` | 297 |
| `packages/assistant-engine` | 125 |
| `packages/assistant-runtime` | 97 |
| `packages/core` | 49 |
| `apps/cloudflare` | 44 |
| `packages/device-syncd` | 42 |
| `packages/query` | 32 |
| `packages/importers` | 25 |
| `scripts` | 21 |
| `packages/cli` | 20 |
| `packages/vault-usecases` | 19 |
| `.agents/skills` | 13 |
| `packages/health-commons` | 12 |
| `packages/contracts` | 10 |
| `packages/hosted-execution` | 10 |
| `packages/health-metrics` | 6 |
| `packages/hosted-local-harness` | 6 |
| `packages/setup-cli` | 6 |
| `packages/operator-config` | 5 |
| `packages/inboxd` | 4 |
| `packages/assistant-cli` | 3 |
| `packages/parsers` | 3 |
| `packages/runtime-state` | 3 |
| `packages/cloudflare-hosted-control` | 2 |
| `config/vitest-temp-lifecycle.ts` | 1 |
Completed: 2026-09-14
