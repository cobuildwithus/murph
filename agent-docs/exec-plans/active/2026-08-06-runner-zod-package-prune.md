# Remove the redundant installed Zod package from the hosted runner

Status: active
Created: 2026-08-06
Updated: 2026-08-07

## Goal

- Remove the installed Zod copy after both production bundles have inlined the
  exact runtime code they execute.
- Preserve published-package dependency and declaration contracts plus every
  current runner and bundled-CLI behavior.
- Reduce image bytes without changing dependency versions or runtime loading.

## Evidence

- The assembled production bundle installs one Zod package totaling about
  5.0 MiB.
- Published declarations need the install-time dependency, but production
  assembly strips declarations and both esbuild outputs inline every root and
  subpath Zod runtime import.
- A copied-bundle experiment removed the package entirely. All 67 emitted
  runner chunks imported successfully, and the bundled CLI retained its help
  and schema surfaces in a network-isolated, read-only Docker image.
- On the current exact application payload, the unpruned and fully pruned
  images are 486,907,126 and 485,746,375 bytes respectively: a 1,160,751-byte
  compressed image reduction from removing 5,084 KiB of allocated package
  footprint.

## Scope

- Require both production bundlers to reject unresolved root or subpath Zod
  imports before removing the installed package.
- Add focused regression coverage for removal ordering, exact package deletion,
  unrelated package retention, and unresolved-import rejection.
- Document the production-only payload policy in the runner deployment owner.

## Constraints

- Keep Zod as an install-time dependency wherever published declarations need
  it; this is final-image shaping, not a package-contract change.
- Do not patch Zod, alter its version, or change application import behavior.
- Remove the installed package only after the CLI and entrypoint bundles pass
  explicit emitted-import guards.
- Keep this independent from the startup-graph and Docker-layer PRs.

## Tasks

1. [x] Measure the installed package and validate a copied-bundle experiment.
2. [x] Implement the post-bundle package prune and focused tests.
3. [x] Run typecheck, focused tests, production assembly, and Docker proof.
4. [ ] Commit, push, open a PR, complete exact-head CI/reviews, and close the
   plan with `scripts/finish-task`.

## Verification

- Focused runtime-shape and container-image contract coverage passes 16 tests
  exercising exact removal, sibling retention, root/subpath import rejection,
  and post-bundle assembly ordering.
- Cloudflare typecheck, workspace-boundary verification, and workspace package
  cycle verification pass.
- Exact production runner assembly succeeds after the current startup-graph
  changes: 1,641,064 entry bytes, 8,054,791 static-boot bytes, and 9,886,264
  total JavaScript bytes. This PR runs only after JavaScript emission, so those
  values are identical to its clean base. Exact assembly removes all 5,084 KiB
  of installed Zod; logical file bytes fall from 90,152,607 to 86,250,923, a
  3,901,684-byte reduction.
- Current exact paired Docker images measure 486,907,126 bytes unpruned and
  485,746,375 bytes fully pruned, a 1,160,751-byte reduction.
- The fully pruned read-only image imports all 67 emitted JavaScript chunks,
  runs the bundled CLI help and schema surfaces, runs as uid 1001, keeps `/app`
  immutable, and confirms `/app/node_modules/zod` is absent.
- The network-isolated full runner smoke reached the Codex permission probe but
  Docker Desktop's emulated kernel returned `ENOSYS` while Codex installed its
  nested seccomp policy. The same environment limitation is outside package
  loading; the direct in-image application proofs above passed.
