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
2. [ ] Land the local completion predicate and staged-runtime guard on the
   current runner assembly implementation.
3. [ ] Run focused tests, typecheck, exact production assembly, and Docker
   deferred-import/device-sync proof.
4. [ ] Commit, push, open a PR, complete exact-head CI/reviews, and close the
   plan with `scripts/finish-task`.

## Verification

- Device-sync typecheck, build, and the 215-test Junction provider suite pass
  after removing the SDK runtime import; emitted device-sync JavaScript has no
  SDK specifier.
- The local ISO-8601 predicate matches the pinned SDK serializer across date,
  datetime, week-date, ordinal-date, invalid-string, empty, and wrong-type
  representative cases.
- Exact current-base assembly and Docker measurements remain pending after the
  Zod runtime-shaping change lands.
