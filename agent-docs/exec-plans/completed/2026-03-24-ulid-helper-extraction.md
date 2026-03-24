# 2026-03-24 ULID Helper Extraction

## Goal

Remove duplicated low-level Crockford/ULID generation logic from `packages/core`, `packages/device-syncd`, and `packages/inboxd` without changing any caller-visible ID prefix, separator, sanitation, or random/state-code behavior.

## Constraints

- Extract only the raw Crockford/ULID pieces into a dependency-safe shared package.
- Keep caller-specific prefix normalization local:
  - `packages/core/src/ids.ts` keeps `normalizePrefix(...)` and `ID_PREFIXES` mapping behavior.
  - `packages/device-syncd/src/shared.ts` keeps `sanitizeKey(...)`.
  - `packages/inboxd/src/shared.ts` keeps `sanitizeObjectKey(...)`.
- Do not edit `packages/cli/src/usecases/vault-usecase-helpers.ts` in this lane because it is already dirty from an overlapping removal task and no longer contains the duplicated generator logic in the current tree.
- Add focused tests before rewiring callers so the extraction is behavior-proving, not assumed.

## Planned Changes

1. Add focused tests for the current public ID emitters in `core`, `device-syncd`, and `inboxd`.
2. Add a shared low-level helper in `packages/runtime-state`.
3. Rewire the three packages to use the shared helper while preserving local sanitation logic.
4. Run targeted tests, then required repo checks and completion audits.

## Exit Criteria

- Shared helper is used by `core`, `device-syncd`, and `inboxd`.
- Focused tests prove no ID-format drift in those packages.
- Required checks pass, or any unrelated blocker is explicitly documented.
Status: completed
Updated: 2026-03-24
Completed: 2026-03-24
