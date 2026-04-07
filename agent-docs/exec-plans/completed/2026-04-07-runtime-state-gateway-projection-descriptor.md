# Add explicit gateway-local projection descriptor

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Add the missing explicit `gateway-local` projection descriptor to the runtime-state aggregate manifest so every durable `.runtime/projections/*` store has an owner/description descriptor.

## Success criteria

- `packages/runtime-state` exports a gateway-local descriptor module and includes it in `vaultLocalStatePathDescriptors`.
- Descriptor classification reports `.runtime/projections/gateway.sqlite` as a `gateway-local` machine-local projection.
- Package docs and tests reflect the explicit gateway-local projection ownership model.

## Scope

- In scope:
- `packages/runtime-state/src/**` descriptor-manifest wiring for the gateway projection path
- `packages/runtime-state/test/**` assertions covering the new explicit descriptor
- Minimal durable package docs needed to keep the manifest/documentation story aligned
- Out of scope:
- Any behavior changes in `packages/gateway-local` store logic or migration behavior
- Broader runtime-state taxonomy refactors beyond the missing gateway descriptor

## Constraints

- Technical constraints:
- Preserve the existing `.runtime` taxonomy and hosted snapshot behavior; projections stay `machine_local`.
- Keep the change narrow and avoid disturbing unrelated dirty worktree edits.
- Product/process constraints:
- Follow the repo package-change verification path and finish with a scoped commit.

## Risks and mitigations

1. Risk: Adding only a descriptor file but missing aggregate wiring or classification tests leaves the manifest gap effectively unfixed.
   Mitigation: Update the aggregate manifest and the existing `describeVaultLocalStateRelativePath` test coverage in the same change.

## Tasks

1. Register the lane in the coordination ledger and inspect the existing runtime-state descriptor/test surfaces.
2. Add the gateway-local projection descriptor module and wire it into the aggregate manifest.
3. Update the smallest doc/test surface that asserts explicit projection ownership.
4. Run required verification, perform final review, and close/commit the plan.

## Decisions

- Keep this as a narrow `packages/runtime-state` ownership cleanup; no gateway-local runtime behavior changes.
- Add the smallest high-signal proof in the existing hosted-bundle test rather than creating a new test file: classify `gateway.sqlite` explicitly and prove hosted snapshots still exclude it.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm --dir packages/runtime-state exec vitest run test/hosted-bundle.test.ts --no-coverage`
- Expected outcomes:
- Both commands pass and the new gateway projection descriptor is covered by the package tests.
- Actual outcomes:
- `pnpm typecheck` failed outside this lane in `apps/web/test/hosted-execution-outbox.test.ts` because in-flight hosted outbox edits removed statuses those tests still reference.
- `pnpm test:packages` failed outside this lane in `packages/cli/scripts/verify-package-shape.ts` because the branch currently still has a pre-existing `@murphai/gateway-core` package-shape assertion mismatch.
- `pnpm test:smoke` passed.
- `pnpm --dir packages/runtime-state typecheck` passed.
- `pnpm --dir packages/runtime-state exec vitest run test/hosted-bundle.test.ts --no-coverage` passed.
- `pnpm exec tsx --eval 'import { describeVaultLocalStateRelativePath } from "./packages/runtime-state/src/node/index.ts"; console.log(JSON.stringify(describeVaultLocalStateRelativePath(".runtime/projections/gateway.sqlite")));'` returned the expected `gateway-local` machine-local projection descriptor.
Completed: 2026-04-07
