# Codex hosted egress route conformance

Status: completed
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
5. Risk: binary heuristics or manually copied provenance can claim completeness
   without proving which upstream source was reviewed.
   Mitigation: make the upstream API source tree the inventory owner; required
   CI resolves the version-derived tag and verifies its commit, subtree object,
   and declared source paths. Binary scanning remains corroborating evidence.

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
- Preliminary ReviewGPT accepted two coverage gaps: unknown provider-anchored
  base-relative literals were not retained generically, and proof labels were
  not derived from observed real-Codex requests. The suite now covers both.
- Final ReviewGPT found that the blocked frameless realtime WebSocket used a
  synthetic suffix. The fixture and Worker proof now use the real exact
  `GET /v1/live` route, deleting the alias.
- Exact-head Linux CI exposed target-specific Rust literal concatenations. The
  scanner now normalizes only those exact reviewed tokens and explicitly
  classifies the two truncated non-route fragments; an independently downloaded
  pinned Linux artifact reports 19 classified candidates.
- Final ReviewGPT round 2 required a retrospective because provider-anchored
  discovery omitted single-segment relative routes and source provenance was
  syntax-only. The suite now covers separated single- and multi-segment
  candidates, while the version-derived upstream tag, exact commit, and exact
  `codex-rs/codex-api/src` tree form the authoritative source identity. Native
  scanning is explicitly corroborating rather than a completeness claim.
- Final ReviewGPT round 3 passed with no qualifying finding. Its four PR-body
  discrepancies were accepted as documentation corrections: the required
  source verifier is CI tooling, performs one pinned public Git fetch, and
  corroborates unique enabled route pathnames rather than distinct source
  records. No code or production behavior changed for those corrections.

## Verification

- Passed focused Codex conformance: 9 tests, including a real pinned App Server
  responses/search/responses turn through `hostedRunnerIntercept`.
- Passed focused adjacent conformance/interceptor suite: 3 files, 256 tests.
- Passed `@murphai/cloudflare-runner` typecheck.
- Passed the final complete Cloudflare suite: 141 Node files with 2,389 tests
  passed and 2 skipped, plus 5 Worker files with 10 tests passed.
- Passed the repository-tool suite: 34 files with 525 tests.
- Passed the workspace typecheck and repository architecture, boundary,
  dependency, provider-request, and log guards. The clean pushed-worktree
  `pnpm test:diff` invocation selected its documented workspace-typecheck
  fallback; the explicit Cloudflare and repo-tool suites cover the changed
  verification owners.
- Passed `pnpm --dir apps/cloudflare verify:codex-upstream-source` locally and
  in required Ubuntu CI, proving the pinned tag, exact commit, exact API source
  subtree, and 10 declared source paths.
- Passed independent exact Linux x64 artifact proof: 19 candidates, all
  classified.
- Preliminary specialist and final ReviewGPT round 1 completed with accepted
  findings; corrections are implemented and locally verified.
- Final ReviewGPT round 2's retrospective finding was accepted and redesigned;
  final round 3 returned `ROUND_OUTCOME: PASS` with no qualifying findings.
- All required GitHub checks passed on reviewed code candidate
  `425730ab8fda698d7d1e7628d4ff6dba41f4358d`.
- Merged the then-current `origin/main` after review without conflicts or task
  behavior changes; the focused 256-test suite and upstream source verification
  passed again before plan closure.
Completed: 2026-08-10
