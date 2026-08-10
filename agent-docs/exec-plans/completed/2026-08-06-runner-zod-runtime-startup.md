# Hosted runner bounded Zod startup

Status: completed
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

- No production dependency addition, bundler source rewrite, alias hack, second
  schema owner, persisted state, queue, or lifecycle manager.
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
5. [x] Complete exact-head CI, ReviewGPT gates, parent final review, plan
   closure, and PR handoff.

## Round 2 retrospective

- The original requirement remains one bounded Contracts-owned Zod surface,
  with Gateway Core as the sole acyclic exception.
- The first remediation used a hand-selected list of remaining consumers and
  repeated the same incomplete-inventory mechanism by missing one dynamic test
  import after removing Inbox Services' dependency. A stale local package link
  could therefore hide the clean-checkout failure.
- Continue the hard cut because it remains net deletion and adds no owner or
  compatibility layer. Replace the hand-selected check with an exhaustive
  workspace import-policy rule covering static, dynamic, and require
  specifiers. Validate Inbox Services after removing its stale local Zod link
  so the proof matches a clean dependency graph.

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
- Ten native startup CPU profiles still attribute most sampled authored-code
  work to the shared contracts/Zod schema chunk; the largest separate
  first-party chunk is Assistant Engine, led by the combined dynamic-tool
  catalog/parser/executor module. This supports phase-boundary separation over
  another broad package rewrite.
- A freshly baked Node module compile cache added 3.1 MiB uncompressed. The
  immutable application tree makes Node disable that read-only cache. Copying
  it into writable temporary storage unlocked about 59 ms of compile savings
  but cost more than that; an end-to-end copy-and-start comparison was about
  130 ms slower under amd64 emulation. This confirms the current image
  contract's prior falsification rather than supporting shipment.
- Syntax/identifier minification with preserved function/class names reduced a
  rebuilt bundle from about 9.8 MiB to 6.8 MiB, but the in-container paired
  median became 12 ms slower. It is not a startup correction; retaining
  readable production output is preferable without separate image-transfer
  evidence.
- A Node 24 startup-snapshot prototype cannot safely serialize the current
  entry graph: Node warns that several built-ins are unsupported and aborts on
  the `node:http` parser's native global handles. Adapting the application to
  snapshot only a schema subgraph would add a second runtime/bootstrap shape,
  so this is not a maintainable near-term path.
- Preliminary ReviewGPT coverage review passed with no findings after one
  attachment-evidence recovery retry on the same exact-head review thread.
- Final ReviewGPT round 1 found that nine migrated packages still declared Zod
  as a direct production dependency, seven type-only namespace imports still
  emitted value edges, and one migrated import was unused. The correction
  moves those nine declarations out of production dependencies, makes the
  seven imports explicitly type-only, deletes the unused import, and routes the
  five remaining consumer tests through the contracts-owned runtime surface.
  Production direct imports and runtime dependencies now remain only in
  Contracts and Gateway Core, whose independent `zod/v4` surface preserves the
  acyclic package boundary.
- Focused remediation proof passed: nine affected package typechecks, six
  focused test files (42 tests), workspace-boundary verification, package-cycle
  verification, and production runner assembly. The corrected assembly retains
  the same 1,729,632 B entry, 8,182,922 B static closure, and 9,862,735 B total.
- Final ReviewGPT round 2 found one Inbox Services test that dynamically
  imported undeclared root Zod after the package dependency was removed. The
  accepted finding repeated the first remediation's incomplete hand-selected
  inventory mechanism, so the requirement-level retrospective above explicitly
  continues the simpler single-owner hard cut and replaces that inventory with
  an exhaustive workspace import-policy rule.
- The missed test now uses the Contracts runtime. The new policy checks static
  imports, dynamic imports, and `require` specifiers across governed workspace
  source and tests, allowing direct Zod only in Contracts and Gateway Core's
  narrow `zod/v4` adapter. Its 35 policy tests, workspace boundaries, and package
  cycles pass. After deleting the stale Inbox Services Zod link and rerunning a
  frozen install, the link stayed absent and the package typecheck plus all ten
  focused tests passed.
- Exact-head CI then exposed a distinct declaration-build requirement: emitted
  schemas still name Zod types, and a clean parallel Importers build could not
  resolve Clinical Records' emitted `zod/v4` references after every non-owner
  declaration was removed. The private schema consumers retain Zod only as a
  build-time dev dependency. A frozen install creates their development links,
  while the exact production assembly reports `devDependencies: skipped` and
  stages no package-local Zod copies for those consumers.
- Clinical Records and Importers builds/typechecks, the exhaustive boundary
  policy, package cycles, and the exact production runner assembly pass after
  that correction. Bundle bytes remain exactly 1,729,632 B entry, 8,182,922 B
  static closure, and 9,862,735 B total.
- Final ReviewGPT round 3 found the public-package exception: Hosted Execution's
  exported declarations name concrete `zod/v4` types, but the release packer
  removes dev dependencies. An isolated typed consumer could therefore fail to
  resolve those declarations even though repository builds pass. Hosted
  Execution now keeps the same Zod version as an install-time dependency; its
  package-surface test locks that classification while all source imports still
  route through Contracts.
- The five publishable packages were built and packed through the real release
  script. A no-hoist temporary consumer installed the packed Contracts, Gateway
  Core, and Hosted Execution artifacts with no ambient root Zod and compiled
  the subscription and physical-notes public subpaths with `skipLibCheck: false`.
  The production assembly still stages only one root Zod copy and the
  bundle bytes remain exactly unchanged.
- Final ReviewGPT round 4 found the second public-package declaration edge:
  the published CLI bundles Vault Usecases declarations that name `zod/v4`,
  while the release packer strips the bundled private package's dependency
  metadata. The CLI therefore also retains Zod as an install-time dependency,
  and its existing package-shape verifier rejects a dev-only classification.
- The real release packer produced all five tarballs. In an isolated pnpm
  consumer with no root-level Zod, the packed CLI manifest declares Zod and
  TypeScript resolves the bundled Vault Usecases `zod/v4` reference through
  the CLI's own install edge. A `skipLibCheck: false` root-import compile then
  passed after neutralizing two unrelated pre-existing declaration defects in
  the temporary consumer (`@murphai/query` and `incur`); no packed artifact or
  repository source was changed for those temporary corrections.
- After the zero-finding final audit, the base-only merge from current `main`
  removed the now-upstream test expectation deltas. Workspace boundaries,
  package cycles, Hosted Execution typecheck, CLI package-shape verification,
  and full production assembly pass on the merge head. The current candidate
  assembly is 1,733,178 B entry, 8,196,127 B static closure, and 9,875,940 B
  total; the 3,546 B entry and 13,205 B closure/total increases are inherited
  from the updated base rather than authored Zod changes.
Completed: 2026-08-06
