# Device syncd WHOOP runtime

Status: completed
Created: 2026-03-17
Updated: 2026-03-17
Completed: 2026-03-17

## Goal

- Port the provided device-sync runtime patch into the current repo so OAuth-backed WHOOP sync can run as a standalone service package and feed the existing device-provider import seam.

## Success criteria

- New `@healthybob/device-syncd` package builds in the workspace and exposes the service/http/provider runtime from the patch.
- Root package and TS references know about `packages/device-syncd`.
- WHOOP importer supports append-only deletion tombstones emitted from provider sync/webhook payloads.
- Focused tests cover the WHOOP deletion normalization plus the new service surface added by the patch.
- Required verification is rerun and any remaining failures are clearly separated from this lane.

## Scope

- In scope:
  - new `packages/device-syncd/**` package files from the patch
  - root `package.json`, `tsconfig.base.json`, and `tsconfig.json` wiring
  - WHOOP importer deletion handling and related tests
- Out of scope:
  - unrelated assistant/web/package-resolution work already active in the tree
  - non-patch product changes beyond what is required to merge cleanly

## Constraints

- Preserve the existing WHOOP/provider foundation commit already landed.
- Do not revert or absorb unrelated active-lane edits in the dirty worktree.
- Avoid touching `.env*`; environment handling must stay in code/docs only.
- Run the required completion workflow after the port is functional.

## Tasks

1. Compare the patch against the current repo shape and merge the root/package/importer deltas.
2. Add the new `packages/device-syncd` package files and reconcile them with current workspace conventions.
3. Run focused tests/typechecks first, then the required repo verification and completion audits.
4. Commit only the device-syncd/WHOOP sync lane once the remaining failures are either fixed or clearly unrelated.
