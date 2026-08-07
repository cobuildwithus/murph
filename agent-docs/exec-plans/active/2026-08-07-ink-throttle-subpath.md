# ink-throttle-subpath

Status: active
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
  declaration, lockfile, and focused regression proof if needed.
- Out of scope: upgrading Ink, changing Murph's Ink UI, changing hosted runner
  boot, or introducing a Murph-owned throttle implementation.

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

## Tasks

1. [complete] Confirm current Ink, latest Ink, and upstream source retain the
   compatibility-barrel import; reproduce current import cost.
2. [in progress] Create the one-line pnpm package patch and lockfile metadata.
3. [pending] Add only the minimum executable regression proof needed to keep the
   patched import from drifting.
4. [pending] Run focused tests, typecheck, dependency guards, frozen install,
   and before/after benchmarks.
5. [pending] Commit, push, open the PR, and complete specialist review plus CI.
6. [pending] Close this plan through the final scoped commit and prove current
   base mergeability.

## Decisions

- Patch Ink 6.8.0 instead of upgrading to Ink 7.1.1 because the latest release
  and current upstream source still import the same broad barrel.
- Keep this separate from the Cloudflare image-layer optimization because it
  affects only local Ink CLI startup.

## Verification

- Patch-content/source-shape regression.
- `pnpm install --frozen-lockfile` and `pnpm deps:guard`.
- Assistant CLI typecheck and focused Ink UI tests/coverage.
- Fresh-process isolated and full Ink import benchmark before/after.
- `git diff --check`, exact-head required CI, preliminary specialist review,
  and mergeability proof.
