# Include exact repo-tools source in upgrade reviews

Status: completed
Created: 2026-10-18
Updated: 2026-10-18

## Outcome and invariant

Complete review and adoption of the published plan-closer correction for Frog
#4178. Reviewers must inspect the exact dependency implementation without
weakening committed-source, integrity, privacy or bounded-archive admission.

## Owner and proven gap

The canonical full review packager calls the existing dependency-context helper
only for ReviewGPT patches. The repo-tools versioned patch rename therefore
omits the implementation source. The first adoption review was invalid for
that evidence gap; no substantive finding was established.

## Smallest correction

Extend the existing helper's fixed supported-package selection to repo-tools.
Derive current and baseline package source and patches from committed lockfiles,
using the same fixed registry, integrity checks and regular-file extraction.
Keep one temporary review-context owner and its existing cleanup lifecycle.
No product state, deployed behavior or new dependency is introduced.

## Failure and scope

Fail closed for bad authority, package identity, integrity, paths and resource
limits. Do not install or execute downloaded package content. Preserve the
existing ReviewGPT source-packaging path and rejection behavior. No changes to
review thresholds, models, permissions or merge gates are in scope.

## Tasks and proof

1. Reproduce the omitted repo-tools source in focused synthetic fixtures.
2. Include both committed versions and exact patches with provenance; test
   both supported packages and existing archive rejection boundaries.
3. Independently inspect the helper and actual canonical archive, run affected
   typecheck, complexity and packaging checks, and update the live owner doc.
4. Commit the scoped correction and Frog record, restart round one on the new
   head with the invalid-attempt history retained, and complete CI and merge.

## Verification

- New repo-tools upgrade regression fails against the original helper and passes
  with the correction. All 23 focused dependency-context tests pass, including
  both supported packages, base integrity and unsafe archive rejection.
- Required tooling diff lane passes: syntax and architecture/privacy checks,
  repo-tools typecheck, all 898 tooling tests and all 29 dependency manifests.
- Packaging and review contracts pass 12 selected tests. Two stale exact patch
  filename references in the release contract now match the adopted 0.1.18.
- Complexity guard passes: maximum function complexity remains 11, zero debt,
  and no hotspot above 20. Parent source and privacy review passes.
- The existing registry authority, integrity checks, archive/privacy limits and
  no-lifecycle-execution boundary remain intact. No member-facing changelog.
- Actual canonical ZIP inspection and fresh exact-head ReviewGPT/CI are tracked
  by PR #4188 before merge; the prior invalid attempt is retained as evidence.
Completed: 2026-10-18
