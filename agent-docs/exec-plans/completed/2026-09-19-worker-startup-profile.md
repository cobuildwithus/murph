# Reduce measured Cloudflare Worker startup cost

Status: completed
Created: 2026-09-19
Updated: 2026-09-19

## Outcome and invariants

Reduce measured startup work in the existing Cloudflare Worker. Preserve caller authentication, Postgres runtime ownership, container fencing, and every supported route. No new service, cache, scheduler, dependency, or production mutation.

## Owner and evidence

The existing Worker entrypoint and its static module graph own startup. Profile the current production-shaped bundle with Wrangler before choosing changes. Production latency motivated this work; private traces stay out of repository artifacts. Local measurements cannot establish production latency savings.

## Approach

1. Capture baseline startup CPU profile and bundle input sizes.
2. Identify the measured expensive initialization and challenge unnecessary eager imports. Prefer deleting accidental dependency reachability or using existing narrow public entrypoints.
3. Make the smallest correction, reprofile, and retain only measured improvements.
4. Run focused behavioral tests, app/package typechecks, bundle validation, complexity review, and applicable completion review. Commit the scoped result.

## Product UX

Outcome: reduce the wait before an existing workspace can receive a message.
Reaches: authenticated Web and Temporal wakes, including fresh Worker instances; other routes retain their behavior.
Proof: comparable before/after startup profiles plus existing auth, warm wake, stale-owner, and fallback tests. Live latency improvement requires a later authorized deployment.

## Risk and deployment

Import narrowing must retain public workspace boundaries and module side effects actually required by consumers. No wire format, persisted state, retry ordering, or authority changes are intended. Validate the real Worker bundle and existing routes. Deployment is outside this task's current authorization.

## Verification

- The pinned Wrangler 4.93.0 built the real Worker entrypoint with its existing compatibility flags. Only container build declarations were omitted in ignored profiling configuration.
- Baseline emitted JavaScript: 4,009,149 bytes. Static-import candidate: 3,643,428 bytes, down 365,721 bytes (9.12%). All eleven Worker exports are preserved. Unused contract examples disappear from the emitted bundle.
- Five alternating fresh-workerd profiles per candidate used prebuilt multipart bundles. Baseline active CPU: 129.120, 127.750, 131.218, 134.090, 134.340 ms; median 131.218 ms. Static imports: 105.580, 99.810, 104.120, 104.090, 99.910 ms; median 104.090 ms (20.68% lower). Values other than medians are rounded to two decimals.
- A minification experiment reached median 100.952 ms. It was not adopted: the smaller source-only correction provides the material CPU reduction without a configuration change.
- Focused Vitest: runtime-resource-client, runtime-media-upload, runtime-replica-upload, index, and auth-adapter; 189 tests passed across five files.
- Cloudflare app typecheck passed after the normal Web Prisma generation prerequisite. The first attempt encountered the existing missing-generated-Prisma-client friction; no type errors were suppressed.
- The emitted candidate ran in local workerd/Miniflare: health 200 with `ok: true`, unauthenticated ensure-processing 401, and unknown route 404.
- `pnpm complexity:diff` passed: source complexity debt remains zero, with no new hotspots. `git diff --check` and `pnpm docs:drift` passed. Final source review confirms the same public contract entrypoints and unchanged validation, authentication, and request behavior.
- No PR is open, so PR CI and Final ReviewGPT are outside the current local completion scope.

## Final shape and boundaries

Three dynamic imports become ordinary imports from the same declared public package entrypoints. No functions, validation rules, network calls, retries, wire contracts, storage, or dependencies are added. The removed import awaits were redundant because these modules already belonged to the eagerly loaded graph.

Product UX: Ready for the local import-only change; existing authentication and resource behavior is preserved. Production latency impact is unverified until a separately authorized deployment and bounded trace comparison.

Changelog: not applicable to this internal, behavior-preserving bundling refactor. The evidence establishes local initialization cost and emitted size, not a measured member-facing latency improvement.

The startup-profile container-build friction is recorded with this task and its local workaround is documented in the app README. No production change or publication is part of this task.
Completed: 2026-09-19
