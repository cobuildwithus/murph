# Include pinned Containers dependency inputs in audit snapshots

Status: completed
Created: 2026-10-18

## Outcome and protected invariant

Canonical full audit snapshots that include the Containers readiness test also
include its exact pinned SDK patch, lockfile, and workspace patch mapping.
Existing archive privacy filters, exact-head review guards, and delta selection
remain authoritative. No dependency, runtime, deployment, or review gate changes.

## Owner and evidence

Frog issue: cobuildwithus/murph#4192. The committed report is
`.agents/friction-log/20261018183332-full-audit-snapshot/friction.md`.
The existing `scripts/repo-tools.config.sh` exact always-path manifest is the
owner. Its source scan excludes the patches directory and root lockfile.
The full archive regression reproduces the missing Containers patch while the
readiness test is present. An earlier review manually included the inputs;
that did not correct canonical selection.

## Smallest correction

Add the pinned Containers patch and lockfile to the existing exact manifest;
the workspace mapping is already included. Extend the existing real lean/full
ZIP regression to check presence and byte equality for all three inputs.
Update the current review owner document. No new selector, downloader, state,
registry scope, package release, or parallel archive mechanism is needed.

## Failure and lifecycle

Existing sensitive-path, binary, output, clean-head, and review provenance guards
remain unchanged. A Containers version update must update the exact manifest
and regression alongside its existing patch/mapping changes. Reverting the two
manifest entries restores prior selection without affecting product behavior.
The existing full/delta context owner continues to choose review scope.

## Verification

- Red: the existing full ZIP includes the readiness test but omits its pinned
  Containers SDK patch; the focused archive regression fails on that path.
- Green: real lean/full ZIP regression passes and verifies exact bytes for the
  patch, lockfile, and workspace mapping, with readiness tests in the full ZIP.
- Three focused packaging, round/delta, and policy-override contracts pass.
- CLI typecheck, changed-file complexity, shell syntax, diff whitespace, and
  documentation drift checks pass. Parent candidate audit passes: selection
  stays with the existing owner and no boundary or runtime behavior changes.
- Exact-head ReviewGPT and required PR CI remain merge gates after publication.

## Changelog and delivery

Internal developer review tooling only; no member-visible changelog entry or
production deployment. Use a scoped draft PR with a non-closing Frog reference.
Verify the merged source before closing the matched issue, then retire the clean
isolated worktree through the repository helper.
Updated: 2026-10-18
Completed: 2026-10-18
