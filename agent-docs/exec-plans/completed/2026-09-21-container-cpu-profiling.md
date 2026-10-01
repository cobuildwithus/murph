# Attribute hosted container CPU stalls to sampled functions

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Goal

Capture bounded CPU attribution across warm and busy container windows so a
future event-loop stall can be attributed to application functions, GC, or
another process without capturing private member data.

## Scope and decisions

- Add continuous 100 Hz V8 main-thread CPU sampling, rotating every ten seconds.
- Keep existing cgroup and per-process CPU accounting for native child processes.
- Report actual Node process CPU, event-loop delay/utilization, memory, and
  bounded self/inclusive frame counts from immutable application assets.
- A blocked loop extends the profile window; it does not prevent V8 sampling.
- No raw profiles, inspector TCP port, request data or member paths in logs.
- This is internal observability, not a proven incident fix or deployment.
- Native child stacks, off-thread native stacks and per-request CPU allocation
  remain outside this sampler's attribution boundary.

## Tasks and success criteria

1. Implement lifecycle-owned, fail-open sampling and privacy-bounded summaries.
2. Test real V8 stack capture during a synchronous stall, privacy, bounds,
   lifecycle failures, and existing entrypoint behavior.
3. Run focused tests, typecheck, complexity and documentation checks.
4. Review, document limitations and close with a scoped commit.

## Risks and mitigations

- Profiling overhead: modest sampling rate; bounded summaries; measure a
  synthetic CPU workload with and without profiling.
- Diagnostic failure: disconnect only the owned session and keep serving.
- Private symbols: unknown sources and their function names become a fixed bucket.
- Sampling is statistical: publish counts, not invented per-function CPU times.

## Verification

- Focused container profiler, watchdog, entrypoint and bundler tests: six files,
  133 tests passed. The real V8 test burns CPU synchronously for 10.5 seconds,
  crosses the rotation deadline, and observes the hot function, extended
  profile duration, process CPU and event-loop stall.
- Cloudflare runner typecheck passed.
- Complexity diff passed with no added debt; bounded stack traversal has a
  dedicated helper rather than making the summary loop a new hotspot.
- Documentation drift and whitespace checks passed.
- Five alternating synthetic arithmetic trials per mode on Node 24.14.1:
  median 702 ms without profiling and 702 ms with 100 Hz V8 profiling (0.0%
  rounded difference). This small local benchmark is not production overhead
  evidence and does not measure all allocation-heavy workloads.
- Full workspace runner build completed. After rebuilding the final Cloudflare
  package, `pnpm --dir apps/cloudflare runner:bundle --skip-build` passed
  production assembly, CLI parity probes, native boot probes and absolute
  budgets: entry 72,977 bytes, static closure 2,109,120 bytes, 24/24 chunks.
  The sampler accepts the existing logger as a callback so its lazy import
  does not add shared chunks to the startup closure. Exact-base relative CI
  remains a future PR check, not a local deployment claim.
- Final logger-injection changes passed the affected 71 tests; the final
  profiler-overhead fields passed the five lifecycle/live tests again.
- Parent review covered lifecycle ownership, privacy, bounded processing,
  sampled versus actual CPU semantics, packaging and deployment limits.
- Changelog skipped: internal diagnostics only; no new member-visible behavior.
- No production rollout authorized or performed. Original incident function
  attribution remains unproven; the new sampler supplies evidence on recurrence.
Completed: 2026-09-21
