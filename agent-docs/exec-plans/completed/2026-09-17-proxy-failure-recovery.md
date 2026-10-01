# Preserve proxy rejection semantics and diagnose runtime failures

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Outcome and invariant

Preserve finite runtime resource rejection codes through the outbound proxy. Stale
owners remain unable to mutate snapshots or replicas; transport failures stay
failures. Diagnostics contain metadata only.

## Evidence and owner

The snapshot resource client discards non-success response codes. The outbound
router returns asynchronous snapshot work without awaiting it inside its error
handler, allowing rejections to escape. Reproduce both with synthetic responses
before extending the existing resource-error boundary shared with replica PUTs.
Separately investigate container monitor failures and isolate memory exhaustion;
no speculative restart, retry owner, dependency upgrade, or authority bypass.

## Product UX

- Outcome: failed snapshot ownership checks remain explicit, recoverable conflicts.
- Reaches: current and superseded checkpoint attempts; no new product flow.
- Proof: typed stale-owner rejection, asynchronous failure containment, unchanged
  admitted heartbeat and replica success paths, no private response propagation.

## Architecture and rollout

Web remains the authority for resource ownership. Reuse the existing finite error
class and JSON boundary, with bounded rejection-body parsing. No new persisted
state, schema, external service, retry, or dependency. Old callers already accept
409 conflicts. Worker-only correction is compatible with existing Web and runner
images; normal protected deployment and post-deploy checks own live proof.

## Tasks

1. Reproduce the resource error-code loss and asynchronous catch bypass.
2. Make the smallest shared resource rejection and router correction.
3. Run focused tests, Cloudflare typecheck, complexity and document checks.
4. Review, commit, push a draft PR; start required final ReviewGPT with exact-head CI.
5. Complete authorized merge/deployment and check fresh error aggregates.
6. Continue memory/monitor diagnosis with bounded metadata; report unproved causes.

## Verification

- Reproduced both defects before implementation with two failing regressions.
- Passed all 334 tests in the outbound and resource-client suites, including the
  composed real router/client boundary, finite conflicts, unknown failures,
  response-body cancellation, admitted snapshots, and replica cleanup.
- Passed Cloudflare typecheck, complexity guard (changed-file debt reduced by
  four), and documentation drift check.
- Parent candidate review passed: finite authority semantics, bounded parsing,
  unchanged writes/retries, synthetic fixtures, and no private evidence copied.
- Implementation complete. ReviewGPT, exact-head CI, merge, deployment, and
  post-deploy observation remain completion gates owned by the active session.
- Separate memory exhaustion is not explained by the observed socket queue or
  artifact sizes. No speculative memory or container-monitor change is included.
Completed: 2026-09-17
