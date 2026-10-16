# Patterns lazy load phase telemetry

Status: active
Created: 2026-10-16
Updated: 2026-10-16

The implementation is authored locally and the parent validated it
independently (below). Still pending, and not passed: exact-head required CI,
final ReviewGPT (blocked until a managed lane is available; not waived), PR, and
deployment (blocked; see Rollout). Not deployed. This change saves no latency.

## Goal

Attribute the `wearables patterns` dispatch residual that falls before the first
query phase. Add three fixed timing phases through the existing CLI timing
pipeline without changing behavior, adding state, or optimizing.

## Evidence

The fixed window ends 2026-10-16 05:30 UTC (latest 72 hours, aggregates only,
no payloads or identifiers). It holds 54 successful Patterns calls: total
196466.2 ms, dispatch 161124.9 ms. The existing non-overlapping inner phases sum
to 107473.8 ms, leaving a 53651.1 ms dispatch residual. Of the 40 single-call
profiles, the nine above 5 s total 63885.4 ms, with 15287.9 ms of residual
dispatch. The historical severe 49 s Patterns call remains unexplained.

On unchanged main, the parent probed the built public service with a fresh
synthetic vault: 5 processes × 3 calls each. The cold first-call residual had a
median of 226.43 ms; warm calls were about 0.1 ms. Preloading `@murphai/query`
cut the first-call median to 61.39 ms. Responses were byte-identical. This is
mechanism evidence only, not a production reproduction or a speed claim.

## Decisions

- `service-runtime-load` wraps only the existing cold
  `import("./usecases/integrated-services.js")` in `vault-services.ts`. The
  factory call and service methods are excluded. The cached promise and the
  reset-on-failure path are unchanged. The fixed name lives in
  `usecases/runtime.ts`, so the public seam keeps its no-direct-lower-owner-import
  guard.
- `query-runtime-load` wraps only `loadRuntimeModule("@murphai/query")` inside
  the cold shared-promise owner of `usecases/runtime.ts` `loadQueryRuntime`. The
  shape check, the wrapping of errors, and memoization are excluded or unchanged.
- `query-projection-load` wraps only the dynamic `query-projection.ts` import in
  the public index `buildPersonalPatternReportRuntime`. Other wrappers are
  unchanged.
- Static-source expectation only: in the unbundled graph,
  `integrated-services.ts` statically imports `@murphai/query`, which reaches
  `query-projection.ts` statically, so cold query evaluation is expected inside
  `service-runtime-load`. Production differs. The runner bundle
  (`apps/cloudflare/scripts/runner-bundle/bundle-shared.ts`, `bundle-cli.ts`)
  bundles and tree-shakes static imports, while `loadRuntimeModule(specifier)`
  stays a native variable import. Production may therefore put native
  query-module loading in `query-runtime-load`. Keep all three phases, and
  assume no production cost split.
- Existing promise memoization and Node's module cache are preserved. No new
  cache, loader, pipeline or dependency. Installed-CLI static closure budgets
  belong to exact-head CI. Static reasoning does not establish zero closure
  growth.
- The history-backed runtime-state test proves old-normalizer compatibility
  only, not the full usage parser.

## Verification

- Author: focused tests for runtime-state catalog/compat, vault-usecases
  loader/runtime, query fixture and mocked load, assistant-engine
  transport/profile, and Cloudflare HTTP budget.
- History-backed normalizer check:
  `MURPH_CLI_LOAD_PHASE_COMPAT_BASE=<reviewed base sha>`.
- Parent, independent: 119 focused tests passed (17 skipped). Typecheck and
  build passed for runtime-state, query and vault-usecases. Complexity passed
  (max 19, debt 0), and so did docs drift.
- Parent probe, same unbundled public service: 30 base and 30 head calls gave
  byte-identical 579-byte responses (SHA-256 parity). Cold head medians:
  `service-runtime-load` 187.398 ms, `query-runtime-load` 0.429 ms,
  `query-projection-load` 0.102 ms, and 0.944 ms residual after the load spans.
  With query preloaded: `service-runtime-load` 61.318 ms, remaining 0.954 ms.
  The base cold residual was 226.43 ms against about 0.1 ms warm. These are
  noisy independent processes, not paired measurements. Diagnostic attribution
  only; no speedup is claimed.
- Pending, not passed: exact-head required CI (including installed-CLI static
  budgets) and final ReviewGPT.

## Rollout

Consumer-first rollout, as specified in `docs/hosted-runtime-log-database.md`.
The user authorizes an isolated telemetry deployment. It is still blocked: the
protected private deployment workflow is main-only and has no candidate SHA
input, so it cannot select this candidate without a merge, which is not
authorized. Run the 24–72 hour observation only after a verified
consumer-then-producer deployment.
