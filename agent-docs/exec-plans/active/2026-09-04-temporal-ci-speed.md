# Reduce Temporal CI build and E2E latency

Status: active
Created: 2026-09-04
Updated: 2026-09-04

## Goal and invariant

Reduce the cross-repository Temporal hosted gate from roughly 30–35 minutes toward a measured under-ten-minute result. Preserve every test, source binding, standby allocation, production-like priority timing, and live deployment admission check.

## Evidence and current owners

Private integration run 33922621756 used 839 seconds for serial runner/Web preparation, then 992 seconds for foreground E2E. Compatibility readers took 30 seconds. Run 33930847337 used 815 seconds preparation and 715 seconds foreground E2E. Its first nine foreground tests took 458 seconds including startup; the independent two-test checkpoint group took 112 seconds. The alert test consumes earlier probe results, so arbitrary test-level sharding would invalidate proof.

Private Murph Cloud owns build scheduling and exact-source handoffs. Public Web owns compiler behavior. Public hosted-local harness owns scenario selection and cleanup. Compiler caches are disposable, never proof or source identity.

## Work

1. Consult ReviewGPT on both repositories and measure the existing job/step critical path.
2. In the private workflow, pin source once, overlap independent Web/runner builds, and restore compiler metadata while retaining full validation.
3. Add explicit Webpack cache opt-in for CI; preserve the existing cold-build default and heap limits.
4. Evaluate independent scenario-process parallelism and generated-input reuse without weakening coverage.
5. Run focused tests/typecheck, cold and warm build proof, and actual CI timing. Complete review and record any remaining gap to ten minutes.

## Verification

Use existing Web config and production-build-runner tests, Web typecheck, and standalone build. Private changes require `pnpm verify` and the real integration matrix. Larger-runner use remains pending user preference and available runner permissions. No deployment is part of this optimization task.

## Candidate evidence and remaining acceptance

ReviewGPT completed the cross-repository design consultation. It endorsed the existing two-process boundary and identified redundant generated-input preparation for a single scenario with two processes. That preparation now runs once; isolated CI shards still earn their own setup. Completed-output and E2E-evidence reuse require separate provenance work and are not implemented in this candidate.

Focused Web tests (53) and harness tests (52), Web/harness typechecks, and the complexity guard pass. The full standalone Web build could not acquire the shared-host slot within ten minutes; the documented SSH fallback is unavailable because no worker address is configured. Cold/warm compiler time, peak memory, and complete GitHub admission time remain unmeasured for this candidate. The under-ten-minute target is not yet achieved.

Private controller fixtures also passed unchanged assertions with two concurrent isolated subprocesses: 127 tests in 742 seconds versus the local serial baseline of 1674 seconds (56% less wall time). All 687 private Temporal coverage tests passed with two file workers. This is separate from the hosted E2E critical path and does not establish under-ten-minute release admission.

Prepared candidates proceed through exact-head PR/CI review; public support must land before private consumption. The initial ReviewGPT consultation is design input, not a final PR gate. The complete admission performance target remains open until measured in private GitHub CI.

## Cached compiler memory follow-up

A real isolated Web CI build exhausted the existing 3 GB compiler heap with persistent caching enabled. Next configures an unlimited additional memory cache for production. The follow-up retains disk caching while setting `maxMemoryGenerations: 0`, and explicitly exercises that opt-in in hosted-Web CI under the existing memory guard and heap limits. Full private integration and cold/warm performance validation remain required; the ten-minute goal is still unproven.
