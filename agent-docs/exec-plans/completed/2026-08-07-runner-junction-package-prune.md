# Remove the Junction SDK runtime payload from the hosted runner

Status: completed
Created: 2026-08-07
Updated: 2026-08-07

## Goal

- Remove the only Junction SDK runtime import from device sync, then classify
  the pinned SDK as a compile/test-only dependency so production never installs
  it.
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
- All other SDK imports in repository TypeScript are private type-only uses or
  the test oracle. Emitted package JavaScript and declarations contain no SDK
  module reference.

## Scope

- Replace the one runtime serializer import with a local behavior-equivalent
  predicate while retaining SDK types.
- Move the SDK to device-sync development dependencies and delete stale direct
  production dependency edges from the CLI and hosted-execution packages.
- Add focused regression coverage proving historical completion behavior and
  final-image loading with the production dependency absent.
- Run production assembly and Docker/device-sync proof before proposing the
  change.

## Constraints

- Do not change Junction behavior, credentials, provider routing, or schemas.
- Keep the pinned SDK available to device-sync source typechecking and tests.
- Do not weaken the existing forbidden-static-boot guard.
- Keep this independent from the Zod and Docker-layer changes.

## Tasks

1. [x] Establish the installed-byte and deferred runtime-import evidence.
2. [x] Land the local completion predicate and make the SDK compile/test-only
   in its owning package.
3. [x] Run focused tests, typecheck, exact production assembly, and Docker
   deferred-import/device-sync proof.
4. [x] Commit, push, open a PR, complete exact-head CI/reviews, and close the
   plan with `scripts/finish-task`.

## Verification

- Device-sync typecheck, build, the 216-test Junction provider suite, and the
  full 882-test package suite pass after removing the SDK runtime import;
  emitted device-sync JavaScript and declarations have no SDK specifier.
- Cloudflare typecheck and 58 focused bundle/runtime/container tests pass, as
  do workspace-boundary and package-cycle checks. The Zod runtime shaper
  remains unchanged; Junction absence is owned by production dependency
  classification and the final-image smoke instead of an install-then-delete
  scanner.
- A table-driven real-webhook differential test matches the local predicate to
  the pinned SDK serializer across calendar, datetime, week-date, ordinal-date,
  passthrough, missing-field, invalid-string, and wrong-type cases. An inline
  record carrier prevents the documented completion fallback from masking a
  mismatch.
- Exact production assembly on current main leaves entry and static startup
  bytes unchanged at 1,646,017 and 7,892,287 while reducing total JavaScript
  from 9,909,524 to 9,858,163 (-51,361).
- The artifact falls from 87,551,284 to 82,127,481 logical bytes (-5,423,803),
  from 111,908 to 92,284 allocated KiB (-19,624), and from 8,656 to 4,317 files
  (-4,339).
- The paired current-main amd64 Docker image falls from 486,046,374 to
  485,175,824 bytes (-870,550). In a network-isolated, read-only container, uid
  1001 imports the deferred device-sync config graph while the SDK is absent.
- The owned final-image smoke now imports the deferred device-sync config graph
  and rejects an installed Junction SDK. Its workflow runs for device-sync
  package and source changes. Local Docker Desktop passed that new boundary,
  then stopped later at the existing unsupported seccomp operation; the exact
  network-isolated image import proof passes, and Linux CI owns the full smoke.
- A ten-pair alternating current-main Docker health benchmark is noise-neutral,
  as expected for a lazy-path/image-shape change: baseline p50 1,282 ms,
  candidate p50 1,291 ms, and paired median -11 ms.
Completed: 2026-08-07
