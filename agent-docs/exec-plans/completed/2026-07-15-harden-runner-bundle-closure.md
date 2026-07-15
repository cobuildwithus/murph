# Harden hosted runner boot-closure verification

## Goal

Restore `main` by removing device-provider importer modules from the hosted
runner's static boot closure, then make the same ownership violation fail in the
owning package's focused verification before full runner assembly reaches CI.

Success criteria:

- Prove the exact static import chain that pulled the forbidden importer modules
  into the runner boot closure.
- Preserve provider behavior while moving only turn-scoped work behind the
  existing lazy boundary.
- Add a focused regression that catches the import-shape violation without
  requiring a full packed runner assembly.
- Pass the required Cloudflare verification, direct bundle assembly, audits,
  scoped commit, direct `main` push, and post-push CI check.

## Constraints

- Do not weaken or delete the existing forbidden-input guard.
- Do not add a dependency, service, lifecycle owner, persisted state, retry
  system, or compatibility shim.
- Preserve unrelated active work and the existing runner-bundle dependency-prune
  lane.
- Keep diagnostics metadata-only and free of secrets or personal identifiers.

## Approach

1. Reproduce the exact `main` failure and recover the metafile import chain.
2. Correct the earliest owning import boundary and add a focused architectural
   regression beside that owner.
3. Run focused tests, truthful diff coverage, and a clean runner bundle assembly.
4. Run the required coverage and deep-review passes, resolve findings, and
   perform the parent final review.
5. Close the plan in a scoped commit, reconcile with remote `main`, push the
   exact commit to `main`, and confirm the relevant CI outcome.

## State

Completed.
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
