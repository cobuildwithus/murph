# Junction Garmin Sleep Webhooks

## Goal

Fix Junction direct webhook handling so Garmin sleep and sleep-cycle payloads with importer-supported fields are accepted and imported instead of falling through to stale or empty REST summary fallback.

Success criteria:

- Keep webhook verification, configured resource, parseability, and unambiguous source guards.
- Collapse duplicated narrow summary-field gating onto the shared historical summary usefulness predicate.
- Cover direct Garmin sleep and sleep-cycle webhook shapes in `packages/device-syncd` tests.
- Run focused tests and required repo verification/audits.

## Constraints

- Do not expose raw health payloads, identifiers, local paths, secrets, or `.env*` contents.
- Preserve unrelated working-tree edits.
- Prefer simple, composable architecture over one-off provider special cases.

## Plan

1. Reuse shared Junction summary usefulness logic for direct summary webhooks.
2. Move importer-supported Junction/Garmin sleep field paths into the importer-owned resource module and reuse them from both importer normalization and direct webhook gating.
3. Add tests proving direct sleep and sleep-cycle webhooks import without REST fallback.
4. Run focused verification, typecheck, and required audits.

## Notes

- Local evidence showed sleep webhook trace rows were processed, but current dirty payload rows only held later non-sleep events.
- Junction docs describe Garmin sleep as incremental `daily.data.sleep.*` / `daily.data.sleep_cycle.*` webhook data, so the direct webhook path must be authoritative when payloads contain useful summary data.
- Simplification review found duplicated sleep field knowledge in `device-syncd`; the fix now shares those path descriptors from `packages/importers`.
Status: completed
Updated: 2026-05-28
Completed: 2026-05-28
