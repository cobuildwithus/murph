# ink-throttle-subpath

Status: completed
Created: 2026-08-07
Updated: 2026-08-07

## Goal

- Reduce first local CLI render startup work by patching Ink 6.8.0 to import its
  sole `throttle` helper from the supported `es-toolkit/compat/throttle` subpath
  instead of evaluating the full compatibility barrel.

## Success criteria

- The pinned Ink package patch changes only the one runtime import.
- A frozen install applies the patch and dependency policy passes.
- Fresh-process benchmarks show the patch removes the compatibility-barrel
  import cost from Ink evaluation without changing exports or rendered behavior.
- Assistant CLI typecheck, focused Ink tests, package coverage, and relevant
  package/build proof pass.
- Exact-head CI, preliminary coverage review, parent final review, and
  mergeability complete without unresolved accepted findings.

## Scope

- In scope: one pnpm patch for `ink@6.8.0`, the workspace patched-dependency
  declaration, lockfile, and the existing public-CLI bundling path required to
  carry that patch into npm installs.
- Out of scope: upgrading Ink, changing Murph's Ink UI, changing hosted runner
  boot/reply behavior, or introducing a Murph-owned throttle implementation.
  The shared pnpm patch is intentionally present in the next runner bundle's
  installed external Ink copy even though that copy is excluded from the
  hosted entrypoint's static boot graph.

## Constraints

- Use only public registry packages already present in the lockfile.
- Keep the patch pinned to Ink 6.8.0 and remove it when upstream adopts an
  equivalent subpath import or Murph upgrades to a release that does.
- Do not add a direct `es-toolkit` dependency to Murph; Ink already owns that
  dependency and the subpath is part of its declared package exports.

## Risks and mitigations

1. Risk: the subpath exposes different compatibility semantics.
   Mitigation: it is the same exported compatibility `throttle` implementation;
   run focused Ink behavior tests and package typecheck.
2. Risk: the patch silently stops applying after dependency drift.
   Mitigation: pin it through `patchedDependencies`, the lockfile checksum, and
   frozen-install proof.
3. Risk: a microbenchmark overstates user-visible impact.
   Mitigation: measure both isolated imports and full Ink import before/after,
   and frame the result only as local first-render startup work.
4. Risk: a workspace-only pnpm patch does not reach public npm installs.
   Mitigation: bundle patched Ink through the existing external-dependency
   release path, promote its already-installed runtime dependencies explicitly,
   and inspect the real packed tarball in the release test.
5. Risk: describing the change as local-only hides its runner artifact impact.
   Mitigation: keep one shared patch, update both Cloudflare bundle-contract
   mirrors, assemble the real runner bundle, prove its installed Ink is patched,
   and prove the hosted entrypoint still excludes Ink from its input graph.

## Tasks

1. [complete] Confirm current Ink, latest Ink, and upstream source retain the
   compatibility-barrel import; reproduce current import cost.
2. [complete] Create the one-line pnpm package patch and lockfile metadata.
3. [complete] Keep regression proof at existing boundaries: the patch checksum
   and frozen install fail closed if the one-line patch drifts, the Ink UI suite
   executes the installed package, and the real-tarball release test proves the
   public CLI contains the patched Ink runtime.
4. [complete] Run focused tests, package coverage, typecheck/build, dependency
   guards, frozen install, rendered-output comparison, and before/after
   benchmarks.
5. [complete] Push, open the PR, and complete specialist review plus CI.
6. [complete] Close this plan through the final scoped commit and prove current
   base mergeability.

## Decisions

- Patch Ink 6.8.0 instead of upgrading to Ink 7.1.1 because the latest release
  and current upstream source still import the same broad barrel.
- Keep this separate from the Cloudflare image-layer optimization because it
  has a different performance goal: the import optimization affects first Ink
  rendering, not hosted boot. Runner assembly still carries the same patched
  external Ink copy so public CLI and runner dependency resolution do not
  diverge.
- Do not add a repository-owned source-shape test for pnpm's patch file. The
  patch checksum already owns application integrity, and the Ink UI suite owns
  executable behavior.
- Bundle Ink in the public CLI tarball. Workspace patch metadata is not an npm
  distribution mechanism; the existing bundled-external path is the smallest
  release owner that preserves the patch for end users.

## Verification

- Patch-content/source-shape regression.
- `pnpm install --frozen-lockfile` and `pnpm deps:guard`.
- Assistant CLI typecheck and focused Ink UI tests/coverage.
- Fresh-process isolated and full Ink import benchmark before/after.
- `git diff --check`, exact-head required CI, preliminary specialist review,
  and mergeability proof.

## Evidence

- Frozen install and dependency-policy guard passed on the rebased candidate.
- Assistant CLI typecheck and build passed.
- Focused Ink UI test: 7 passed; package coverage: 22 files and 128 tests
  passed, with 94.07% statement and 85.84% branch coverage.
- The unpatched and patched Ink modules exposed identical export keys and
  identical `renderToString` output for the focused smoke case.
- CLI release package shape passed; the focused release audit passed all 42
  tests with prepared runtime artifacts and verified the actual packed tarball
  contains Ink's patched subpath import.
- A fresh global install of that tarball (without the repository workspace or
  lockfile) retained the patched import. In 31 alternating fresh-process
  samples against a fresh registry Ink 6.8.0 install, full-import p50 measured
  121.441 ms upstream versus 75.570 ms in the installed Murph tarball:
  -45.870 ms and -37.77%.
- The two Cloudflare bundle-closure contracts were updated to recognize Ink as
  an external bundled dependency while keeping it out of workspace build
  closure; 14 focused tests and Cloudflare typecheck passed.
- Final ReviewGPT round 1 accepted one affected-surface finding: the shared
  patch changes the next runner artifact even though it does not change the
  hosted boot graph. The two stale contract assertions were already corrected
  on the test-only follow-up head. The PR/plan disclosure is corrected and the
  real runner-bundle proof below resolves the remaining request; remediation
  review is pending.
- Full Cloudflare node verification passed: 136 files and 2,273 tests.
- Real runner assembly applied the shared patch and materialized a final bundle
  whose installed `ink/build/ink.js` imports only
  `es-toolkit/compat/throttle`; the broad barrel import is absent. The
  entrypoint metafile's existing `/ink/` forbidden-input guard passed, as did
  all six bundled-versus-unbundled vault-cli parity probes.
- The patched candidate and a no-Ink-patch control on identical current main
  produced the same 8,878,190-byte vault-cli bundle and the same 9,896,614-byte
  runner entrypoint output, proving zero package-size or boot-graph delta from
  this patch. The entry chunk (1,650,524 bytes) and static closure (7,927,658
  bytes) remain within their existing caps.
- The real assembly stops at current main's 9,884,153-byte total-output ratchet;
  the no-patch control fails identically at 9,896,614 bytes. A temporary local
  probe budget allowed final artifact inspection, then was restored without a
  commit. This pre-existing 12,461-byte current-main overage is unrelated and
  is not folded into this dependency patch.
- Final ReviewGPT round 2 passed with no findings against exact pushed head
  `34ce8bb160af10d2faa8d931bfd76a0f1506e435` after an approximately 18-minute
  correction audit. The guarded packet confirmed correction scope, same-thread
  context, first/previous/context-anchor ancestry, and model slug
  `gpt-5-6-pro`. The earlier malformed retry omitted required round environment
  metadata and was correctly discarded as `INVALID` before substantive review.
- Parent final review found no additional issue.
- Exact-head GitHub release/build/typecheck, app verification, CLI host matrix,
  package coverage, bundle closure, runner permission, frontend, artifact, and
  hermetic billing checks passed. The live Stripe job was cancelled before
  meaningful execution by the repository-wide shared concurrency lane; rerun
  it sequentially on the final docs-only closure head.
- In 41 alternating fresh-process samples, the compatibility barrel measured
  90.585 ms p50 versus 6.661 ms for the throttle subpath. Full Ink import
  measured 222.809 ms p50 unpatched versus 143.184 ms patched: -79.625 ms and
  -35.74%. These measurements apply only to local CLI first rendering.
Completed: 2026-08-07
