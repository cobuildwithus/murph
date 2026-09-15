# Simplify active runtime wake transport

Status: active
Created: 2026-09-15
Updated: 2026-09-15

## Outcome and evidence

Wake the exact existing runtime through its native container port without
entering SDK startup, cached lifecycle-state reads, or response proxying.
The pinned Containers SDK's `containerFetch` reads state and may call
`startAndWaitForPorts` before forwarding even when the platform is running.
Its existing installed-SDK regression test proves that behavior. Wake admission
already checks runtime identity and has its own bounded response handling.

Production investigation localized rare delay before the recorded wake entry;
the evidence does not establish the SDK helper as that stall's cause. This
change removes a demonstrated unnecessary dependency and makes the existing
wake timing include its authority check. It makes no claimed production speedup.

## Scope and smallest design

- Reuse the native container port, existing wake identity checks, timeout,
  metadata drain, and exact-fence recovery. Add no cache, retry, service,
  configuration, diagnostic fields, or state owner.
- Remove the duplicate outer member-binding read and interaction bookkeeping
  from active ensure calls; the wake owner remains authoritative.
- Delete the alternate legacy wake RPC and response-normalization branches.
  Production/current and retained-image container classes inherit the unified
  `ensureProcessing` method from the Worker artifact. The alternate branch's
  only consumers were obsolete test doubles, not older Node container images.
- Preserve typing placement, consent serialization, cold-start readiness,
  completion, mismatched/stopped runner recovery, and old container responses.
- Keep Web/Temporal retry policy and SDK lifecycle scheduling out of this
  patch: neither is established as the measured stall's cause.

## Product UX

Outcome: An existing conversation reaches its existing runtime without startup work.
Reaches: Direct and group messages using active runtime wakes, including a lost local pointer.
Result: Ready. Focused journeys cover a ready native port with unavailable SDK state,
stale SDK status, exact identity, transport failure/timeout, and abort/stop races;
ordinary cold starts keep readiness. Wrong-member warm admission still rejects.

## Tasks

1. Reproduce unnecessary SDK dependency with a focused wake regression.
2. Replace the helper call with native port fetch and remove duplicate admission work.
3. Update the durable wake contract and run focused tests, typecheck, and complexity checks.
4. Review, commit, and obtain applicable exact-head CI and final ReviewGPT evidence.

## Compatibility and risks

Worker-only change using the same container HTTP endpoint, body, headers, and
deadline. Old/new container processes remain supported; no schema or migration.
Native transport errors reach the existing catch instead of SDK error responses.
Tests must prove that errors preserve the active fence and never start a container.
The protocol's activity renewal and lifecycle/identity fences remain in place.

## Verification

The native-port regression failed against the original implementation and passes
with the simplification. Installed-SDK proof: 13 tests passed. Runner, slot-binding,
UserRunner, and transport-failure suites: 555 tests passed. After removing the
alternate RPC branch, UserRunner and Worker routing suites: 353 tests passed.
Cloudflare typecheck passed on the final source. Complexity guard passed;
`ensureActiveRuntimeProcessing` dropped from 16 to 10. Its file's summed
complexity dropped from 55 to 34. The changed wake method retains its required
identity, abort/stop, and older Node response branches.

Pending: changelog and documentation checks, final candidate review, exact-head CI,
and final ReviewGPT. No production deployment or latency gain is claimed.
The inter-object stall still needs production attribution after this simplification.
