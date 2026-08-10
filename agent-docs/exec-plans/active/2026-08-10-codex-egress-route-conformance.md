# Codex hosted egress route conformance

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Add a future-proof regression suite that fails when the pinned Codex CLI can
  reach a provider route that Murph's hosted OpenAI egress policy has not
  explicitly reviewed.
- Reuse the production-client/production-interceptor conformance pattern from
  the Linq and Telegram route suite while retaining the Worker's fail-closed
  credential and route authority.

## Success criteria

- The exact `@openai/codex` version is coupled to a reviewed upstream route
  inventory, so a Codex version bump cannot pass without route review.
- Every inventoried OpenAI route has an explicit hosted disposition: exercised
  and allowed, allowed behind a transport precondition, or intentionally
  blocked because Murph cannot invoke that feature.
- Reachable HTTP routes are driven through production Murph clients or the real
  pinned Codex App Server and then through `hostedRunnerIntercept`; tests prove
  the Worker injects its credential and strips runner authority headers.
- Negative cases prove unsupported routes and malformed websocket attempts stay
  blocked without provider egress.
- Focused tests, relevant typechecks, preliminary specialist ReviewGPT, final
  ReviewGPT, and exact-head CI pass with no accepted finding left unresolved.

## Scope

- In scope: Codex/OpenAI route discovery fixtures, version alignment checks,
  hosted egress conformance tests, narrowly required test seams, and testing or
  security documentation.
- Out of scope: enabling new Codex features, broadening the production allowlist
  merely because upstream contains a route, live provider calls, and changing
  provider credential ownership.

## Constraints

- The Worker remains the only owner of real provider credentials and the final
  route decision.
- Tests must run offline and deterministically in ordinary CI.
- An upstream route inventory is a review gate, not a generated production
  firewall. Updating it must require an explicit disposition for every route.
- Reuse existing real-Codex and hosted provider test infrastructure; add no new
  runtime dependency or registry without a current demonstrated need.
- Keep private identifiers, credentials, and local paths out of durable
  artifacts.

## Risks and mitigations

1. Risk: dynamic scenarios cover only familiar behavior and miss a newly
   hard-coded Codex route.
   Mitigation: bind the route inventory to the exact Codex pin and fail the
   version-alignment contract until the inventory is reviewed.
2. Risk: a generated inventory silently widens production egress.
   Mitigation: keep policy and inventory separate; require an explicit hosted
   disposition and preserve fail-closed negative tests.
3. Risk: a manifest-only test agrees with itself but not the shipped client.
   Mitigation: run reachable routes through production clients or the real
   pinned App Server, and record upstream source provenance for the complete
   inventory.
4. Risk: platform-specific binary scanning makes CI flaky.
   Mitigation: scan the exact installed artifact on each supported platform,
   keep normalization limited to reviewed Rust literal concatenations, and
   require production Linux CI while treating other platforms as diagnostics.

## Tasks

1. Map every OpenAI endpoint in the pinned Codex release and classify whether
   Murph's hosted App Server configuration can invoke it.
2. Ask ReviewGPT to critique the inventory/conformance architecture and missing
   route families before implementation.
3. Add the reviewed inventory/version gate and production-boundary conformance
   tests, including fail-closed negative cases.
4. Update the test/security ownership docs and run focused tests plus affected
   typechecks.
5. Commit and push a scoped candidate, run preliminary specialist and final
   ReviewGPT on immutable heads, remediate accepted findings, and verify exact-
   head CI and merge cleanliness.
6. Close and archive this plan after all required gates pass.

## Decisions

- Extend the Linq/Telegram cross-boundary test strategy instead of introducing a
  second egress implementation or a shared generated firewall registry.
- Treat realtime routes present in Codex as blocked unless Murph explicitly
  enables realtime App Server features and adds corresponding transport proof.
- Treat Codex-owned web search as hosted-reachable and require its exact
  `POST /v1/alpha/search` policy entry and conformance case.
- ReviewGPT's architecture pass required asymmetric ownership: binary discovery
  may fail CI but can never generate or widen the production policy. The final
  suite therefore keeps reviewed dispositions in a test-only fixture, scans the
  exact installed native artifact, and exercises deterministic reachable routes
  through the production Worker boundary.

## Verification

- Passed focused Codex conformance: 7 tests, including a real pinned App Server
  responses/search/responses turn through `hostedRunnerIntercept`.
- Passed focused adjacent conformance/interceptor suite: 3 files, 253 tests.
- Passed `@murphai/cloudflare-runner` typecheck.
- Passed the complete Cloudflare node suite: 141 files, 2,383 tests passed and 2
  skipped.
- Passed `pnpm test:diff`, including the affected Cloudflare node and Workers
  suites plus repository architecture, boundary, dependency, and log guards.
- Pending exact-head CI, preliminary specialist ReviewGPT, final ReviewGPT, and
  plan closure.
