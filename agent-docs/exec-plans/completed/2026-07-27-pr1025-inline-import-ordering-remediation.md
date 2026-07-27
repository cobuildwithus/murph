# PR 1025 inline import ordering remediation

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Ensure every preserved credential-independent Junction inline carrier reaches
  canonical import before acknowledgement.
- Keep runner resource configuration authoritative only for work that requires
  provider fetch.

## Round-three finding and retrospective

ReviewGPT round 3 found that the shared classifier is evaluated too late in the
Junction executor. The runner first applies its independently configured
resource subset. When Web accepted an inline resource that the runner subset
does not enable, the runner could record an unsupported success and schedule a
reconcile without importing the carrier. Normal job completion would then
acknowledge and delete the only accepted payload.

This is the same requirement-level mechanism covered by the completed round-two
retrospective: cleanup and execution must share one authority for accepted
credential-independent carriers. The classifier is complete, but execution
still consults the fetch configuration authority before it. The correction
therefore stays inside the retrospective's decision:

- move direct-inline classification and import before the configured
  fetch/fallback gate;
- leave configuration filtering, event-type fallback, and provider fetch
  unchanged for jobs without an eligible inline carrier;
- add no epoch column, compatibility state, queue, manager, scheduler, or
  reconciliation loop.

Exact-head CI also exposed that the round-two shared classifier lived in the
generic hosted-runtime module while importing Junction normalizer modules.
That made the hosted runner load provider/importer code in its static boot
closure and made release app verification depend on newly introduced package
subpaths. The boundary correction keeps the generic delete/companion rule in
hosted runtime, moves the exact Junction inline rule beside the Junction
provider, and loads that provider-owned rule dynamically during each hosted
sync turn before passing it into the synchronous SQLite hydration transaction.
Web dynamically loads the same public rule during reconnect cleanup. This
removes the unnecessary core and root-importer dependencies: the importer
exposes a narrow Junction leaf whose
meal-id implementation remains byte-for-byte locked to the existing contract,
and no new core subpath is required. The result keeps one exact classifier
without adding persisted state.

## Approach

1. Reorder Junction resource execution so an eligible direct input imports
   before any configured-resource or event-type-fallback decision.
2. Add provider-boundary regressions with distinct Web-admission and
   runner-execution summary subsets:
   - an accepted inline resource absent from the runner subset and with no
     configured fallback imports once with zero provider fetches;
   - an accepted inline resource whose event type resolves to a different
     configured fallback still imports the accepted resource once with zero
     provider fetches;
   - the existing no-inline hijack regression continues to use the configured
     fallback fetch.
3. Keep Junction importer authority behind the per-turn dynamic boundary while
   injecting it into local epoch cleanup; prove the packaged hosted-runner boot
   closure and release app module-resolution boundary.
4. Run focused provider tests/typecheck, canonical diff verification, full
   acceptance, parent review, exact-head CI, and final ReviewGPT round 4.

## Evidence

- Focused typechecks passed for device-syncd and assistant-runtime.
- Focused tests passed:
  - device-syncd complete package: 866;
  - assistant-runtime hosted hydration: 79;
  - importers complete package, including deterministic meal-id parity: 381;
  - Web reconnect dirty-state and OAuth stores: 53.
- The exact hosted-local runner assembly and a build-reusing assemble-only pass
  both completed. The static boot closure is 7,852,242 bytes, below its
  ratcheted budget, with the Junction importer confined to a dynamic chunk.
- The Web production build completed without the broad project file-tracing
  warning; the importer leaf and authority subpaths both resolve from their
  built package exports.
- Canonical diff verification passed across all affected workspace owners,
  including 866 device-syncd tests, 381 importer tests, 6,870 Web tests,
  1,992 Cloudflare node tests, 2 Cloudflare Workers tests, package-boundary
  checks, the Web production build, and the hosted runner assembly.
- Full acceptance passed, including workspace typechecking, coverage gates,
  package-boundary checks, the Web production build, and Cloudflare
  verification.

## Deployment

- Preserve the existing Cloudflare/runner-first order and exact-fingerprint
  proof before Web deploy.
- No schema or durable-owner change is required.
Completed: 2026-07-27
