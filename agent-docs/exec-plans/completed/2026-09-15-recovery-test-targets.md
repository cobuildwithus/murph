# Recovery test target routing

## Outcome

Make the hosted-local activity-expiry control reach the runner selected by the
existing user state, including a retained target after its write fence settles.
Preserve the restart proof's canonical checkpoint and exact-delivery assertions.

## Evidence and scope

The control derives a legacy member/version name, while ordinary runner
allocation now retains an opaque target in the user state. Expiring the legacy
object cannot stop the selected container. Only hosted-local test control code
and focused tests change; production routing and lifecycle policy stay intact.

## Steps

- Add focused routing and state-projection regression proof.
- Read the selected active or retained target through the test-only user owner.
- Route activity expiry through the existing namespace router.
- Run focused tests, Cloudflare typecheck, complexity and privacy checks.
- Complete the public proof correction and recheck full integration.

## Related friction

Reuse the existing hosted-local graceful-stop target-routing report; this is
another test control with the same stale target assumption.

## Verification

- All 360 tests in the route and user-runner-alarm suites passed.
- Five focused active/retained/routing cases passed. Restoring the original route
  made the primary and next-bank cases fail while the legacy case still passed.
- Cloudflare typecheck and the complexity guard passed; no source hotspot exceeds 20.
- Privacy and diff checks passed. No production code path or lifecycle policy changed.
- Public exact-head CI and full paired integration remain completion gates in the PR.
Status: completed
Updated: 2026-09-15
Completed: 2026-09-15
