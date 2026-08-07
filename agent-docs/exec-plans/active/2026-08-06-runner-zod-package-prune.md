# Prune unused Zod payloads from the hosted runner

Status: active
Created: 2026-08-06
Updated: 2026-08-07

## Goal

- Remove Zod package payloads that the production runner does not execute.
- Preserve the supported Zod v4 runtime surface and every current runner/CLI
  behavior.
- Reduce image bytes without changing dependency versions or runtime loading.

## Evidence

- The assembled production bundle installs one Zod package totaling about
  5.0 MiB.
- Its shipped TypeScript sources account for about 2.8 MiB; v3 and the mini
  compatibility trees account for another roughly 0.4 MiB.
- A copied-bundle experiment reduced Zod to about 1.7 MiB and the complete
  runner bundle by about 3.3 MiB.
- The matching Docker image was 881,759 bytes smaller and passed Zod v4 parsing,
  JSON Schema conversion, bundled CLI startup, non-root, and read-only-image
  checks.

## Scope

- Add an explicit runner-assembly rule for Zod's source, v3, mini, v4-mini,
  and root locale compatibility payloads.
- Add focused regression coverage for both deleted and retained package paths.
- Document the production-only payload policy in the runner deployment owner.

## Constraints

- Do not add a generic source-directory pruning rule.
- Retain Zod v4 classic/core/locales and the root runtime entrypoints.
- Do not patch Zod, alter its version, or change application import behavior.
- Keep this independent from the startup-graph and Docker-layer PRs.

## Tasks

1. [x] Measure the installed package and validate a copied-bundle experiment.
2. [x] Implement the package-specific assembly prune and focused tests.
3. [x] Run typecheck, focused tests, production assembly, and Docker proof.
4. [ ] Commit, push, open a PR, complete exact-head CI/reviews, and close the
   plan with `scripts/finish-task`.

## Verification

- The focused runtime-shape suite passes four tests, including exact retained
  and removed paths; the container-image contract suite passes 11 tests. Both
  suites pass again after merging the current base (15 tests total).
- Cloudflare typecheck, workspace-boundary verification, and workspace package
  cycle verification pass.
- Exact production runner assembly succeeds after the current startup-graph
  changes: 1,641,064 entry bytes, 8,054,791 static-boot bytes, and 9,886,264
  total JavaScript bytes. This PR runs only after JavaScript emission, so those
  values are identical to its clean base. The installed Zod directory is 1,780
  KiB, down from 5,084 KiB, and the complete assembled bundle is 111,924 KiB,
  exactly 3,304 KiB below the matching unpruned payload.
- A paired copied-bundle Docker build reduced image size by 881,759 bytes. The
  current exact candidate image is 486,037,498 bytes and repeats the Zod,
  bundled-CLI, non-root, immutable-app, and path-shape proofs below.
- The exact pruned image passes root `zod` and `zod/v4` parsing plus JSON Schema
  conversion, bundled `vault-cli` startup, non-root execution, immutable `/app`
  checks, and exact retained/removed path assertions.
- The network-isolated full runner smoke reached the Codex permission probe but
  Docker Desktop's emulated kernel returned `ENOSYS` while Codex installed its
  nested seccomp policy. The same environment limitation is outside package
  loading; the direct in-image application proofs above passed.
