# Cloudflare workspace artifacts patch

## Goal

Land the requested hosted-runtime patch so hosted persistence now uses one encrypted workspace snapshot in the existing `vault` bundle slot, externalizes large raw artifacts into separate encrypted objects, restores those artifacts back onto disk before hosted runs, and keeps per-user env overrides separate.

## Constraints

- Integrate onto the current refactored tree rather than replaying the historical patch literally.
- Preserve the existing hosted bootstrap and per-user env split that already landed.
- Keep public hosted bundle slots stable: continue using the `vault` slot for the hosted workspace snapshot and return `agentStateBundle: null` for newly created snapshots.
- Maintain legacy hosted bundle compatibility where the current tree still needs to restore older `agent-state` payloads.
- Do not revert or rewrite unrelated dirty work in the repository.

## Files In Scope

- `ARCHITECTURE.md`
- `packages/runtime-state/{README.md,src/{hosted-bundle.ts,hosted-bundles.ts},test/hosted-bundle.test.ts}`
- `packages/assistant-runtime/src/{hosted-runtime.ts,hosted-runtime/{environment.ts,execution.ts,models.ts}}`
- `apps/cloudflare/{README.md,src/{bundle-store.ts,node-runner.ts,runner-container.ts,runner-outbound.ts},test/{index.test.ts,node-runner.test.ts,runner-container.test.ts}}`

## Plan

1. Upgrade the hosted bundle format and hosted execution snapshot helpers to support artifact refs plus workspace-snapshot semantics.
2. Thread artifact restore and upload behavior through the split assistant-runtime environment/execution seams.
3. Add Cloudflare encrypted artifact storage and runner outbound/container routing.
4. Update focused tests and docs to match the new behavior.
5. Run focused verification, then repo-required checks, and commit only the touched files if the outcome is defensible.

## Risks

- The patch was authored against an older monolithic hosted-runtime file, so the behavior must be re-homed carefully into the current split modules.
- Existing tests assume `agentStateBundle` is populated for newly created snapshots; they need to be adjusted without breaking legacy-restore coverage.
- Artifact upload/fetch behavior must avoid redundant network calls while still restoring every externalized file deterministically.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
