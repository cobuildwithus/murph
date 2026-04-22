# Implement the next clean device-sync provider architecture slice after the manifest registry foundation

Status: completed
Created: 2026-04-22
Updated: 2026-04-23

## Goal

- Make the provider-manifest registry the single source of truth for device-sync job definitions, so provider job payloads stop being stringly typed and hosted hint shaping no longer depends on a parallel allowlist seam.

## Success criteria

- Every built-in provider manifest declares its supported job kinds plus payload field schemas.
- Hosted hint shaping derives from provider job definitions rather than a separate `hostedHintPayloads` map.
- Generic ingress/service boundaries validate provider job payloads before durable enqueue and before execution.
- Focused tests cover manifest completeness, payload validation, and hosted-hint derivation from the shared job definitions.

## Scope

- In scope:
- `packages/device-syncd/src/config/provider-manifests.ts`
- directly coupled `packages/device-syncd/src/{hosted-hints.ts,public-ingress.ts,service.ts}`
- focused `packages/device-syncd/test/{provider-manifests,hosted-hints,public-ingress,service}.test.ts`
- matching architecture/readme notes if the ownership wording changes materially
- Out of scope:
- provider-internal file splits for Oura/Strava transport modules
- new durable resource-cursor persistence
- hosted Prisma/device-sync storage changes outside the shared job-shape seam

## Constraints

- Technical constraints:
- Preserve the current provider runtime behavior and job kinds; this refactor should harden boundaries, not change sync semantics.
- Do not add new dependencies.
- Keep hosted/local public-ingress behavior provider-agnostic.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Follow the repo completion workflow for a standard/high-risk repo code change.

## Risks and mitigations

1. Risk: Rejecting job payloads too aggressively could break existing provider tests or runtime jobs.
   Mitigation: Keep the schemas aligned with current provider payload semantics, validate at narrow boundaries, and add focused regression tests for accepted shapes.
2. Risk: Parallel hosted-hint and job-schema definitions could drift again if both remain in the manifest.
   Mitigation: Remove the parallel hosted-hint allowlist seam and derive hosted hints directly from job field specs.

## Tasks

1. Extend provider manifests with provider-owned job definitions and shared payload-field metadata.
2. Replace manifest hosted-hint allowlists with hosted-hint derivation from job definitions.
3. Validate provider job payloads in public-ingress, service enqueue paths, and worker execution.
4. Add focused tests and update docs wording if the ownership description changes.

## Decisions

- Resource cursors stay out of this landing. The next clean slice is provider-owned job schemas and generic validation; durable cursor storage would widen the risk surface too much for the same change.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff packages/device-syncd/src/config/provider-manifests.ts packages/device-syncd/src/hosted-hints.ts packages/device-syncd/src/public-ingress.ts packages/device-syncd/src/service.ts packages/device-syncd/test/provider-manifests.test.ts packages/device-syncd/test/hosted-hints.test.ts packages/device-syncd/test/public-ingress.test.ts packages/device-syncd/test/service.test.ts packages/device-syncd/README.md ARCHITECTURE.md`
- `pnpm test:smoke`
- `pnpm --dir packages/device-syncd test:coverage`
- Expected outcomes:
- Typecheck passes, the touched device-syncd slice has coverage-bearing proof, and the new manifest/job-schema tests stay green without widening provider behavior.
Completed: 2026-04-23
