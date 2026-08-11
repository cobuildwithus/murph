# Prune unused Zod surfaces from the hosted runner

Status: completed
Created: 2026-08-06
Updated: 2026-08-07

## Goal

- Keep the installed Zod root and v4 runtimes required by deferred package
  loaders while removing build-only and unused variants from the image.
- Preserve published-package dependency and declaration contracts plus every
  current runner and bundled-CLI behavior.
- Reduce image bytes without changing dependency versions or runtime loading.

## Evidence

- The assembled production bundle originally allocated 5,084 KiB to Zod even
  after the general declaration/map prune.
- The runtime package contains 2.6 MiB of TypeScript source, legacy v3 code,
  and mini variants that no staged JavaScript imports.
- A full-package removal prototype passed emitted-chunk imports but failed a
  real deferred boundary: clinical-record maintenance loads an installed
  workspace package by computed specifier, and that package still resolves the
  installed `zod/v4` runtime. Bundling every computed target duplicated 1.88
  MiB into the CLI bundle and exceeded its guarded byte budget, so that design
  was rejected.
- The smaller production shaping step retains `zod` and `zod/v4`, rejects any
  staged JavaScript import of a surface selected for removal, and removes only
  `src`, v3, and the mini variants.

## Scope

- Scan the staged runtime, bundled outputs, and installed packages that declare
  Zod before pruning; allow only retained root and v4 runtime imports.
- Remove Zod TypeScript source, legacy v3, and mini variant directories after
  both production bundles are emitted.
- Add focused regression coverage for retained/runtime paths, removed paths,
  sibling-package preservation, guard failure, and assembly ordering.
- Document the production payload policy in the runner deployment owner.

## Constraints

- Keep Zod installed for deferred package-loader paths and keep its root and v4
  runtime surfaces complete, including ESM, CommonJS, core, classic, and locale
  files.
- Keep Zod as an install-time dependency wherever published declarations need
  it; this is final-image shaping, not a package-contract change.
- Do not patch Zod, alter its version, or duplicate installed workspace runtime
  modules into the bundled CLI merely to delete the package directory.
- Keep this independent from the startup-graph and Docker-layer PRs.

## Tasks

1. [x] Measure the installed package and falsify unsafe full removal.
2. [x] Implement the retained-runtime prune and focused tests.
3. [x] Run typecheck, focused tests, production assembly, and Docker proof.
4. [x] Commit, push, update the PR, complete exact-head CI/reviews, and close the
   plan with `scripts/finish-task`.

## Verification

- Cloudflare typecheck and 17 focused runtime-shape, container-contract, and
  smoke-bundle tests pass.
- Exact runner assembly succeeds on the current startup graph: 1,641,254 entry
  bytes, 7,885,509 static-boot bytes, and 9,902,746 total JavaScript bytes,
  identical to the clean base.
- Zod logical runtime bytes fall from 3,902,667 to 1,260,601 (-2,642,066), and
  allocated package footprint falls from 5,084 KiB to 1,664 KiB (-3,420 KiB).
  Whole-bundle logical bytes fall from 90,175,461 to 87,533,395.
- Exact paired Docker images measure 486,938,645 bytes unpruned and 486,043,010
  bytes pruned, a 895,635-byte compressed image reduction.
- In the network-isolated, read-only amd64 image, the deferred clinical-record
  package and retained Zod root/v4 surfaces import successfully as uid 1001;
  every selected source/v3/mini path is absent. Bundled CLI help, LLM metadata,
  and schema commands all exit successfully.
Completed: 2026-08-07
