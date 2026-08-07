# Remove the bundled Junction SDK payload from the hosted runner

Status: active
Created: 2026-08-07
Updated: 2026-08-07

## Goal

- Remove the installed Junction SDK copy after the production runner bundles
  the exact device-sync code it executes.
- Preserve hosted Junction device sync and the bundled CLI behavior.
- Reduce image-transfer and extraction bytes without moving device sync onto
  the eager startup path.

## Evidence

- The assembled runner carries about 19 MiB of `@junction-api/sdk`, split
  almost evenly between generated ESM and CommonJS trees.
- The hosted runner's device-sync maintenance chunk already contains the exact
  ESM serialization implementation used by the Junction provider.
- The installed SDK is absent from the static boot closure by an existing
  forbidden-input guard.
- The bundled CLI contains no runtime reference to the SDK.

## Scope

- Add an explicit production-assembly rule that removes the installed SDK only
  after the entrypoint and CLI bundles have been produced.
- Add focused regression coverage proving the installed payload is absent and
  the lazy Junction code remains bundled.
- Run production assembly and Docker/device-sync proof before proposing the
  change.

## Constraints

- Do not change Junction behavior, credentials, provider routing, or schemas.
- Do not remove the package dependency from source packages that compile
  against it.
- Do not weaken the existing forbidden-static-boot guard.
- Keep this independent from the Zod and Docker-layer changes.

## Tasks

1. [x] Establish the installed-byte and emitted-import evidence.
2. [x] Implement the explicit post-bundle removal and focused guards.
3. [x] Run focused tests, typecheck, exact production assembly, and Docker
   device-sync proof.
4. [ ] Commit, push, open a PR, complete exact-head CI/reviews, and close the
   plan with `scripts/finish-task`.

## Verification

- Five focused Cloudflare test files pass 61 tests, including exact removal,
  sibling-package retention, emitted-import rejection, assembly ordering, and
  the container image contract.
- Cloudflare typecheck passes.
- Exact production assembly succeeds. The JavaScript output is unchanged at
  1,729,632 entry bytes, 8,596,243 static-closure bytes, and 10,282,554 total
  bytes; the installed SDK is absent and the assembled bundle is about 19 MiB
  smaller on disk.
- Importing every emitted runner chunk after package removal succeeds.
- A network-isolated, read-only `linux/amd64` Docker image imports every emitted
  chunk, runs the bundled CLI, confirms the SDK is absent, runs as uid 1001,
  and confirms `/app` is immutable.
- Paired Docker images measured 486,876,562 bytes before and 486,117,445 bytes
  after, a 759,117-byte compressed image reduction.
