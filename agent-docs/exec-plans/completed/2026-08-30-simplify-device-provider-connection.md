# Simplify device provider connection metadata

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Make `connection` the only provider connection-metadata owner while preserving every provider's exact callback path, configured scopes, and runtime behavior.

## Success criteria

- `DeviceProviderDescriptor` has no parallel `oauth` representation or compatibility fallback.
- OAuth2 connection descriptors require their callback path and default scopes at compile time.
- Configured Oura, WHOOP, and Strava runtime scopes remain defensively copied onto `connection.defaultScopes`.
- All repository consumers and fixtures use the canonical connection descriptor.
- Focused importer/device-syncd tests, package typechecks, and package-boundary proof pass.

## Scope

- In scope: importer provider-descriptor types/literals; device-syncd descriptor builders, credential inference, public projection, registry checks, and directly affected tests/fixtures.
- Out of scope: provider API behavior, OAuth protocol behavior, callback routes, persisted state, wake/retry/history work, UI behavior, and unrelated compatibility cleanup.

## Constraints

- Technical constraints: preserve callback strings and scope ordering exactly; preserve default `kind: "none"`; avoid mutation of shared descriptor arrays; keep package dependency direction unchanged.
- Product/process constraints: work only in the assigned worktree; use deletion over a new compatibility layer; archive this plan with `scripts/finish-task`; create a draft PR without ReviewGPT or readiness changes.

## Risks and mitigations

1. Risk: configured scopes could remain on the removed field and silently fall back to static defaults.
   Mitigation: move every runtime builder atomically and retain integration tests for custom scopes and baseline immutability.
2. Risk: non-manifest test/custom OAuth providers could lose credential inference.
   Mitigation: infer fallback credentials from `connection.kind === "oauth2"` and cover the registry/policy seams.
3. Risk: removing the fallback could change descriptors that omit `connection`.
   Mitigation: preserve `resolveDeviceProviderConnectionDescriptor(...).kind === "none"` and update all repository fixtures together.

## Tasks

1. [x] Inventory every legacy OAuth descriptor property, helper/type, and connection resolver consumer.
2. [x] Replace the descriptor shape with one discriminated connection union and migrate production consumers/builders.
3. [x] Migrate focused fixtures/tests and remove only supporting files proven consumer-free.
4. [x] Run focused tests, typechecks, boundary checks, diff/privacy review, and changelog classification.
5. [x] Prepare the plan for archival and the scoped task commit.

## Decisions

- This is an internal architecture simplification with intentionally unchanged behavior, so changelog is not applicable.
- No compatibility shim is retained because the packages are workspace-private and every repository consumer moves atomically.

## Verification

- Passing proof: importer provider-descriptor tests (7), device-syncd descriptor/manifest tests (38), registry capability tests (4), the selected public projection test (1), importer/device-syncd/assistant-runtime/Web package typechecks, workspace boundary verification, and final diff/privacy checks.
- Optional broad-run note: the daemon-wide suite was stopped after an unusually long silent tail; two unrelated Junction scheduling/history tests timed out both in that run and alone without assertion failures. Neither test file nor its production owner changed in this refactor.
- Expected outcomes: callback paths and configured/default scope arrays remain exact; all selected tests and typechecks pass; no remaining legacy OAuth descriptor property or helper references exist.
Completed: 2026-08-30
