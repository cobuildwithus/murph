# Patch Node runtime and vulnerable dependencies

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Outcome and invariant

Ship Node 24.22.1, Next 16.3.8, and targeted patched dependencies through the existing release owners. Preserve runtime authority, authentication, workspace data, and package supply-chain policy. No schemas or protocols change.

## Evidence and owners

The October 21 Node advisory fixes high-severity Brotli, DNS and TLS issues. Main pins Node 24.14.1 in local, CI, package-engine and container owners. The lockfile contains Next 16.3.0 and vulnerable Undici copies. The production audit reports six critical and 69 high findings before changes.

Existing owners are package manifests, pnpm workspace overrides and lockfile, the runner base-image contract, and protected hosted release workflows. No new state or abstractions are needed.

## Scope and decisions

- Update runtime pins, Docker digest, installer minimum and live runtime documentation together.
- Update Next and its ESLint plugin together; update all Undici copies.
- Apply bounded version-specific security overrides for compatible vulnerable transitive packages. Preserve release-age, provenance and build-script policy.
- Triage unpatched http-cache-semantics and braces advisories and the deepmerge-ts major upgrade separately; do not silently force a breaking major through Prisma.
- Historical measurements and completed execution plans remain unchanged.

## Deployment and failure

Use the normal reviewed PR and protected release workflows. Web and runner have unchanged wire and persisted contracts and can roll independently. Existing containers need completed image replacement before the Node fix is effective. Do not roll back without exact authorization. Keep production credentials in hosted workflows. Verify the deployed artifact and runtime, not merely merge success.

## Tasks and verification

1. Patch and install with Node 24.22.1; inspect manifest/lockfile and audit deltas.
2. Run dependency guard, audit, ignored-build review, installer and image-contract tests, and affected typechecks. CI owns broad verification and native runner smoke.
3. Review the patch, complete required ReviewGPT concurrently with exact-head CI, and merge only after required gates pass.
4. Ship Web and runner through existing release owners and verify completion.

## Evidence

- Node 24.22.1 macOS binary verified against upstream SHA-256; Docker manifest digest resolved from the official Node registry image.
- Dependency policy passed; no automatically ignored builds. Release-age and provenance gates remained enabled.
- Full audit after targeted remediation: zero critical, three high, 25 moderate, four low. The high findings are retained and disclosed: Prisma local config uses deepmerge-ts 7; the Workflow SWC binary downloader transitively includes http-cache-semantics (no cache configured in the inspected downloader); Shadcn glob tooling includes braces. The latter two have no published fix. This is not a clean-audit claim.
- Cloudflare runner/base/bundle contract suites: 55 tests passed after updating the pinned digest assertion.
- Installer contract: one test passed. Next configuration and OG routes: 49 tests passed. Real Sharp image/GIF and compression-equivalence checks: 18 tests passed.
- All 28 package/app typecheck owners passed after adapting Sharp's ESM factory and named test types. Root verification prerequisite guards passed; initial typecheck attempts exposed and guided those compatibility fixes.
- Complexity guard passed: no new hotspots or complexity debt. Source changes are one runtime type alias and a base-image tag; no application logic change.
- Private Temporal Render runtime pins are handled in a separate owned patch; public runtime protocols remain unchanged.
- ReviewGPT round 1 passed at de798a088a0ce82bfa95acd982cd2f96991ff83c: no qualifying findings. The subsequent changes are isolated host-setup test expectations and this evidence record.
- CI identified old escaped Node-version assertions in host setup dry-run tests. Updated only their expected version; all 63 setup tests pass locally.
- Implementation is complete. Exact-head CI, merge and production rollout are operational follow-through tracked by PR #4289 and its private runtime companion; this record does not claim deployment.

## Changelog

Internal security maintenance; no intended member-visible workflow change.
Completed: 2026-10-21
