# Bound Cloudflare container port probes

Status: completed
Created: 2026-08-30
Updated: 2026-08-31

## Goal

- Remove the avoidable multi-second cold-start stall caused by a pre-listen
  Cloudflare TCP-port probe remaining pending after the runner has begun
  listening, without changing runtime admission, fencing, health, or lifecycle
  ownership.
- Product UX classification: Patch.
- Outcome: cold hosted replies no longer inherit an avoidable readiness-proxy
  wait when the runner itself is already starting normally.
- Reaches: existing cold hosted conversation startup across the shared
  RunnerContainer path; no channel, audience, permission, or response behavior
  changes.
- Proof: the real patched dependency must beat the production timing model by
  at least 2 seconds while preserving one start, sequential settled probes,
  healthy-state publication, onStart, abort, crash, and strict /health behavior.
  The production image and local platform path must be exercised as far as the
  host can faithfully support, with any architecture/emulation blocker recorded
  instead of treating distorted local timing as managed-platform evidence.

## Success criteria

- `@cloudflare/containers` remains the lifecycle owner through
  `startAndWaitForPorts`; no raw container-start or duplicate readiness path is
  introduced.
- Murph opts into a 1,500 ms per-probe deadline while retaining the existing
  250 ms retry interval and outer readiness budget.
- An actual-package deterministic A/B matching the observed production phase
  timings shows more than 2,000 ms median-path savings in the modeled
  start-to-ports span.
- The same test proves timed-out probes abort and settle before retry, the
  platform start and onStart each happen once, and state becomes healthy only
  after a successful port probe.
- Caller abort and true container-crash cases remain fail-closed with no late
  healthy transition or dangling probe.
- Focused RunnerContainer tests, Cloudflare typecheck/build, dependency guards,
  and isolated Node/Workers projects pass. The exact production image builds;
  any inability to complete the production-shaped hosted-local delivery
  scenario is recorded with the failing infrastructure layer and next proof.
- The benchmark reports start-to-ports, process-to-listen, and listen-to-ports
  spans so a later managed-Cloudflare canary can accept only a >=2 second p50
  win with no failure-rate regression.

## Scope

- In scope:
  - Pin and locally patch the current Cloudflare Containers helper.
  - Add an opt-in per-port-probe timeout that defaults to upstream behavior.
  - Configure the three RunnerContainer startup paths to use the bounded probe.
  - Add actual-package lifecycle/timing coverage and expose existing benchmark
    phase timestamps as aggregate durations.
  - Reconcile hosted runtime and deploy documentation.
- Out of scope:
  - Bypassing `startAndWaitForPorts`, changing runtime health or write-fence
    semantics, changing the runner image, or shortening the outer startup
    deadline.
  - Deploying to Cloudflare or claiming that local Docker proves the managed
    port-proxy latency improvement.
  - An upstream Cloudflare pull request.

## Constraints

- Technical constraints:
  - Every probe retry must use a real AbortSignal and await fetch rejection;
    a naked Promise.race is not acceptable because it can leave overlapping
    requests.
  - Defaults for unconfigured package consumers stay at 5,000 ms.
  - Strict runner `/health`, bundle/source fingerprint, poison, cleanup, and
    generation checks remain after port connectivity.
  - The dependency is exact-version pinned so a lock refresh cannot silently
    drop the local patch.
- Product/process constraints:
  - Local proof may establish correctness and the modeled saving only. A
    managed-Cloudflare canary remains the release proof for the real >=2 second
    median outcome.
  - Production evidence stays aggregate and identifier-free.
  - No upstream PR or production deployment is part of this task.

## Risks and mitigations

1. Risk: A short timeout abandons the JavaScript wait but not the native fetch,
   causing overlapping probes.
   Mitigation: use the helper's AbortSignal path and assert max in-flight probes
   is one and zero remain unsettled after success, abort, and crash.
2. Risk: Reimplementing readiness skips Cloudflare state, monitor, or hook
   behavior.
   Mitigation: preserve `startAndWaitForPorts` and patch only its opt-in probe
   deadline.
3. Risk: Faster polling observes a transient false `container.running` value.
   Mitigation: retain current error semantics, include true-crash coverage, and
   require a managed canary to show no increase in crash, restart, cleanup, or
   startup-failure rates before rollout.
4. Risk: Local Docker passes while the managed Cloudflare proxy behaves
   differently.
   Mitigation: keep the claim explicitly conditional on a later 30-50 sample
   managed canary; do not deploy in this task.

## Tasks

1. Capture the current helper/version and benchmark ownership boundary.
2. Add the real-package deterministic failing timing/lifecycle reproduction.
3. Upgrade to the current patch release, add the local dependency patch, and
   opt RunnerContainer into a 1,500 ms probe deadline.
4. Add call-site, abort, crash, no-overlap, and benchmark-output coverage.
5. Run dependency, focused, package, image, and hosted-local verification.
6. Complete Product UX walkthrough, review gates, documentation, plan closure,
   and a scoped local commit handoff. Do not open an upstream pull request or
   deploy the patch.

## Decisions

- Keep Cloudflare's lifecycle helper instead of adding a custom start/probe
  implementation.
- Add an opt-in timeout rather than changing the package-wide default; this
  keeps unrelated consumers at upstream behavior and permits an exact A/B in
  the actual-package test.
- Use 1,500 ms: this is Cloudflare's prior helper value, production `/health`
  is roughly 50 ms p50, and the production-shaped timing model still clears the
  requested two-second saving with fewer aborted probes than 500 ms.
- Use `@cloudflare/containers` 0.3.7 as the patch base because it includes the
  latest directly relevant start/stop state-race correction while retaining
  the same hard-coded 5 second probes.
- A 24-hour aggregate direct-cold cohort had 16 causal samples: accepted to
  runner-job p50 was about 6.35 seconds and readiness p50 was about 4.81
  seconds. Nine samples with the newer subdivisions had start-to-ports p50
  4.476 seconds, process-to-listen p50 0.939 seconds,
  listen-to-ports p50 2.776 seconds, and final health p50 0.053 seconds. These
  aggregates identify the port-proxy wait rather than Node boot or health as
  the removable median bucket.
- The actual-package timing model reproduces 4.475 seconds with the unchanged
  default and 1.850 seconds with the 1.5 second opt-in, a modeled 2.625 second
  saving. This is a counterfactual for the measured phase, not a claim that
  local Docker reproduces managed Cloudflare latency.
- Cloudflare originally added a bounded probe to stop readiness fetches from
  hanging, [first near 300 ms](https://github.com/cloudflare/containers/commit/674380f1aa7b3cc468ca44f41df808243d6d63e1),
  [then 1.5 seconds](https://github.com/cloudflare/containers/commit/69a978a320378b427ba06640d362e11cfc2b37ae).
  The value later [became five seconds](https://github.com/cloudflare/containers/commit/168fb9697f5b583aad712eb3f6e00b5b280d074f)
  in an unrelated scheduling change without a documented safety rationale.
  There is no exact open issue. Draft
  [containers PR 109](https://github.com/cloudflare/containers/pull/109)
  proposed a configurable timeout, while stale
  [containers PR 188](https://github.com/cloudflare/containers/pull/188)
  proposes composable readiness but keeps five-second built-in probes.
- Public Workerd source shows request abort
  [closes the probe](https://github.com/cloudflare/workerd/blob/29ee6949f48c3bd97b5bec542777f53ef42a3397/src/workerd/api/http.c%2B%2B#L1676-L1739)
  and [tears down its tunnel](https://github.com/cloudflare/workerd/blob/29ee6949f48c3bd97b5bec542777f53ef42a3397/src/workerd/api/container.c%2B%2B#L1097-L1106)
  rather than stopping the container. Managed peer-side implementation remains
  private, so a managed canary is still required before rollout.

## Verification results

- The actual patched package passes six lifecycle tests covering the 2.625
  second modeled saving, both modified probe sites, direct prewarm start,
  listener cleanup, caller abort, true crash, sequential retries, and no late
  healthy transition.
- RunnerContainer passes 1,216 tests. The platform project passes 1,293 tests
  with two intentional skips; the deploy project passes 244; the Workers
  project passes 15. Cloudflare typecheck and build pass.
- Frozen install, dependency policy, ignored-build policy, exact patch hash,
  exact installed-package resolution, and dry-run application to pristine 0.3.7
  pass. The dependency audit reports the same existing 79 advisories as the
  untouched lockfile, so this patch adds none.
- The canonical Node command passes 2,759 tests with two intentional skips.
  The three existing projects run in their original workspace, and the six
  actual-package helper tests use a dedicated config because registering that
  alias-sensitive helper in the mixed workspace could keep Vitest alive after
  the tests settled.
- The optional parallel verifier passed typecheck and all 15 Workers-runtime
  tests, then its unchanged no-cache Node workspace process remained alive for
  12 minutes without a reported test failure. The exact owned process tree was
  interrupted cleanly; the canonical serial Node command above is green, while
  this pre-existing no-cache/coordinator shutdown flake remains explicit.
- The exact production amd64 Dockerfile and runner artifact build. Local
  Workerd, its container proxy, the production entrypoint, Node startup, abort,
  and cleanup were exercised. A full delivery benchmark did not produce valid
  samples: the ARM path hits the known QEMU child-subreaper bug, while isolated
  whole-system x86 emulation is too slow for the existing 60-second deploy
  smoke and distorts latency. No production code or image entrypoint was changed
  to make the repro pass.
- Release proof remains 30–50 alternating managed fresh starts. Require at
  least a two-second p50 improvement, no new startup-failure category or failed
  start increase, and candidate p95 no more than one second slower before
  widening traffic.

## Residuals and handoff

- The inherited implicit `containerFetch()` auto-start fallback retains the
  upstream five-second timeout. The three authoritative Murph startup paths use
  1.5 seconds, so the fallback is outside the measured median path and remains
  conservative.
- The published package's source maps all point to source files omitted from
  the npm artifact. This patch does not regenerate one already-unusable map;
  runtime code and declarations are patched and verified.
- Changelog: not applicable to this local, unshipped patch. Do not publish a
  numeric member-visible claim until the managed canary proves it.
- No upstream pull request or production deployment is part of this handoff.
Completed: 2026-08-31
