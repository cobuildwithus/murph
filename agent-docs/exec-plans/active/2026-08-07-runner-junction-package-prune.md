# Remove the Junction SDK runtime payload from the hosted runner

Status: active
Created: 2026-08-07
Updated: 2026-08-07

## Goal

- Remove the only Junction SDK runtime import from device sync, then remove the
  installed SDK copy from the assembled runner.
- Preserve hosted Junction device sync and the bundled CLI behavior.
- Reduce image-transfer and extraction bytes without moving device sync onto
  the eager startup path.

## Evidence

- The assembled runner carries about 19 MiB of `@junction-api/sdk`, split
  almost evenly between generated ESM and CommonJS trees.
- A single non-type import of `@junction-api/sdk/serialization` loads the
  generated serialization barrel and its roughly four thousand ESM files when
  the deferred device-sync package is evaluated.
- That import parses one five-field historical-completion envelope, and the
  caller only consumes the provider slug. A local predicate can preserve the
  pinned serializer's field and ISO-8601 acceptance without a generated
  runtime dependency.
- All other SDK imports in repository TypeScript are type-only. The dependency
  remains available at compile time for the package's declarations.

## Scope

- Replace the one runtime serializer import with a local behavior-equivalent
  predicate while retaining SDK types.
- Add an explicit production-assembly rule that rejects any staged JavaScript
  SDK import before removing the installed package.
- Add focused regression coverage proving historical completion behavior, the
  runtime-import guard, installed-payload removal, and sibling retention.
- Run production assembly and Docker/device-sync proof before proposing the
  change.

## Constraints

- Do not change Junction behavior, credentials, provider routing, or schemas.
- Do not remove compile-time SDK dependencies while public declarations still
  reference their types.
- Do not weaken the existing forbidden-static-boot guard.
- Keep this independent from the Zod and Docker-layer changes.

## Tasks

1. [x] Establish the installed-byte and deferred runtime-import evidence.
2. [x] Land the local completion predicate and staged-runtime guard on the
   current runner assembly implementation.
3. [x] Run focused tests, typecheck, exact production assembly, and Docker
   deferred-import/device-sync proof.
4. [ ] Commit, push, open a PR, complete exact-head CI/reviews, and close the
   plan with `scripts/finish-task`.

## Verification

- Device-sync typecheck, build, and the 216-test Junction provider suite pass
  after removing the SDK runtime import; emitted device-sync JavaScript has no
  SDK specifier.
- Cloudflare typecheck and 60 focused runtime-shape, entrypoint-bundle, and
  container-contract tests pass. Workspace-boundary and package-cycle checks
  pass on the combined Zod/Junction shaper.
- A table-driven real-webhook differential test matches the local predicate to
  the pinned SDK serializer across calendar, datetime, week-date, ordinal-date,
  passthrough, missing-field, invalid-string, and wrong-type cases. An inline
  record carrier prevents the documented completion fallback from masking a
  mismatch.
- Exact production assembly leaves entry and static startup bytes unchanged at
  1,641,254 and 7,885,509 while reducing total JavaScript from 9,902,746 to
  9,851,385 (-51,361).
- The artifact falls from 87,533,395 to 82,109,953 logical bytes (-5,423,442),
  from 111,788 to 92,268 allocated KiB (-19,520), and from 8,655 to 4,316 files
  (-4,339).
- The paired amd64 Docker image falls from 486,043,010 to 485,175,172 bytes
  (-867,838). In a network-isolated, read-only container, uid 1001 imports the
  deferred device-sync, importer, clinical-record, Zod root, and Zod v4 paths;
  the SDK is absent, `/app` is immutable, and CLI help, LLM metadata, and schema
  commands all exit successfully.
- The owned final-image smoke now imports the deferred device-sync config graph
  and rejects an installed Junction SDK. Its workflow runs for device-sync
  package and source changes. Local Docker Desktop passed that new boundary,
  then stopped later at the existing unsupported seccomp operation; the exact
  network-isolated image import proof passes, and Linux CI owns the full smoke.
- A ten-pair alternating local Docker health benchmark is noise-neutral, as
  expected for a lazy-path/image-shape change: baseline p50 1,308 ms, candidate
  p50 1,311 ms, and paired median -28 ms.
