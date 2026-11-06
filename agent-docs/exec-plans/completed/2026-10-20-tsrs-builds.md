# tsrs build adoption and CI measurement

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Goal

Extend the measured tsrs source-check win into package and workspace emission, with equivalent runtime artifacts and compatible declarations. Measure actual Linux CI savings with paired runs.

## Scope and decisions

- Use the existing compiler runner for supported-host package and workspace builds, retaining explicit TypeScript fallback and existing worker budgets.
- Keep TypeScript 5 for tools requiring its JavaScript compiler API, including Next and Workflow internals. Move the separate generated-route CLI check only after positive/negative contract proof. Keep framework bundlers and tsx runtime execution.
- Preserve platform fallback, supply-chain pins, clean-build proof, and protected deployment gates.
- No product behavior or wire schema change is intended. Validate emitted output and consumers before enabling emission.

## Tasks

1. Track the parent source-check/Oxlint PR merge/deployment separately while its final CI finishes.
2. Compare cold JavaScript/declarations, exercise real declaration consumers, and prove incremental edits and compiler switching.
3. Adopt safe emission paths through the existing runner and add focused regression coverage.
4. Run paired Linux CI check/build benchmarks with identical sources, budgets, and isolated cold/warm state.
5. Run tests, typecheck, boundary proof and exact-head CI; obtain ReviewGPT and open the follow-up PR.

## Risks and mitigation

The Rust compiler follows a newer TypeScript upstream than the retained TS7 binary. Declaration formatting differences require consumer proof; runtime JavaScript must match. Cross-compiler incremental state must rebuild correctly. Unsupported hosts retain TS7. CI timing is reported separately from total pipeline latency and provider billing.

## Verification

Local implementation and verification complete:

- TS7 and tsrs clean emission: identical 5,284 output paths; all JavaScript and JS maps byte-identical. Thirteen declaration files and eleven declaration maps differ in destructuring/member order.
- TypeScript 5 consumer assertions accept every changed module's value exports and fifteen named non-generic types bidirectionally. A whole-library declaration semantic sweep exhausted the default Node heap; focused exported-surface and built-package consumer proof replaces that overly broad probe, not a claim that the entire dependency declaration graph is error-free.
- Regression tests cover referenced dependency edits, rejected stale consumer types, repaired output and compiler switching. Next type generation plus a deliberately invalid `generateStaticParams` export produces TS2344 with both TS5 and tsrs; repair passes. The production runner still rejects inherited bypass flags and stops before compilation on failure.
- Three alternating cold real Next-contract runs: TS5 29.708/32.157/39.676s, tsrs 1.743/1.989/2.109s. Medians 32.157s and 1.989s (93.8% reduction) on the same Apple Silicon host. This is local command timing, not hosted pipeline savings.
- Clean workspace build and full typecheck pass using tsrs. Focused repo-tool tests: 31; Web runner/migration tests: 73; release-lane tests: 10; three built-package boundary suites: 13. Web Oxlint passes with existing warnings. Complexity guard, docs drift/gardening, shell/Node syntax and artifact hygiene pass.
- A paired Ubuntu workflow will measure cold/warm checks, Next-generated contracts and workspace builds on one source/runner with equal native budgets, and verify JS output parity in every round. Hosted results and ReviewGPT are pending and will be recorded in the PR; no hosted speedup is claimed here.

## Completion boundaries

Internal tooling only: no member UI, prompt, wire schema or runtime source change. Existing runner/platform fallback, clean-build owner, Next typegen, prepared-check gate, and protected deploy workflows remain the owners. No new dependency or cache service. Next/Workflow keep TS5 for their compiler APIs; bundlers and runtime tsx remain unchanged. The parent session owns #4238 deployment and this follow-up PR's hosted measurement/review.
Completed: 2026-10-20
