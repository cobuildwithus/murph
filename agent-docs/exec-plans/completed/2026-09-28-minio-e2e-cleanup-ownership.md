# Keep E2E MinIO cleanup within its build

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

## Goal and protected invariant

A completed or failed hosted-local E2E suite removes only MinIO containers from
its existing build identity. Concurrent builds keep their storage containers.

## Owner and smallest correction

The E2E suite already allocates one build identity and calls the MinIO exact-build
cleanup owner. Remove its redundant global E2E sweep and the now-unused helper;
preserve exact-container cleanup, bounded Docker commands, and runner cleanup.
Reuse the committed Frog report `20260917125211-hosted-local-e2e` without
inventing an issue binding while Action reconciliation is pending.

## Scope and proof

- Add a regression through the real suite orchestration with mocked cleanup
  effects for two build identities, on success and failure.
- Retain focused MinIO Docker-boundary and deadline/error tests using the
  surviving exact-build cleanup entrypoint. No real Docker mutation is needed.
- Run focused suites, harness typecheck, complexity, docs checks, parent review,
  required ReviewGPT and exact-head CI before authorized low-risk landing.
- Internal-only harness behavior; no product UX, runtime deployment, dependency,
  credential, or provider-input change.

## Progress

- Source inspection proves the suite invokes an exact-build cleanup then a
  second label-only sweep that can delete another E2E suite's containers.
- Temporal preflight lane confirmed its files do not overlap.
- Both success and failure regression cases failed on the original source: the
  foreign build disappeared. The patch removes the redundant global sweep.

## Verification outcome

- Both regression cases failed before the source change and pass afterward.
- Focused E2E-suite and MinIO suites: 58 passing tests; all Docker/process effects
  are mocked. No real container was removed or stopped.
- Harness typecheck, complexity guard (zero hotspots above 20), docs drift,
  doc gardening, and diff whitespace checks pass.
- Parent candidate review found no issues and confirmed the narrow internal
  harness scope. ReviewGPT and exact-head CI remain PR landing gates; merge
  and retirement will be recorded on the PR after their actual verification.
Completed: 2026-09-28
