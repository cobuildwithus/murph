Goal (incl. success criteria):
- Make the wearable query surface treat `whoop_v2` (Junction's WHOOP implementation slug) as the canonical public provider `whoop`, so `--provider whoop` resolves all WHOOP-family sources (manual ZIP export with `externalRef.system: "whoop"` plus Junction `whoop_v2` sync) instead of only the stale ZIP import.
- Keep canonical vault provenance untouched: no event rewrites, `externalRef.system` and `dataOrigin.sourceProviderSlug` stay as ingested.
- Success means: `wearables * --provider whoop` includes Junction `whoop_v2` data; public outputs/source-health/projection rows report provider `whoop` with display name `WHOOP`; `--provider whoop_v2`/`whoop-v2` are accepted and canonicalize to `whoop`; the Junction direct-duplicate selection penalty recognizes `whoop_v2` as a duplicate of direct `whoop` evidence.

Constraints/Assumptions:
- No bulk rewrite/migration of vault events; this is a query/normalizer-layer identity fix.
- Provider identity vocabulary stays in the shared descriptor registry (`packages/importers/src/device-providers/provider-descriptors.ts`), per `docs/device-provider-contribution-kit.md`.
- Device-sync connect/config surfaces keep using raw implementation slugs (`whoop_v2` for Junction routing); only the public query identity is aliased.
- Preserve unrelated worktree edits and ledger rows.

Key decisions:
- Add optional `aliases` to `DeviceProviderDescriptor` and set `aliases: ["whoop_v2", "whoop-v2"]` on the WHOOP descriptor; make `resolveDeviceProviderDescriptor` alias-aware and expose `canonicalizeDeviceProviderSlug`.
- Canonicalize at the existing public-provider seams only: `resolveWearablePublicSourceProvider` (query origin), `resolveProjectionPublicProvider` (projection grouping), CLI `--provider` input normalization, and the Junction direct-duplicate comparison in selection.
- Do not change `automationDeviceActivitySourceValues` (`whoop` already matches `whoop-v2` there) or device-sync connect routes.

State:
- Implemented and verified; final commit pending.

Done:
- Root-cause evidence: candidates filter compared user `whoop` against public slug `whoop-v2`; projection rows keyed `providers:whoop-v2` unreadable via `providers:whoop`.
- Descriptor aliases + canonicalization at the identity seams; fixture comparison helper; focused tests; coverage-write and task-finish-review audits.
- Review fixes: rebased onto origin/main (post #142/#146 stored codec) and re-verified; bumped `QUERY_PROJECTION_SQLITE_VERSION` 8 -> 9 so pre-fix projections re-key `providers:whoop-v2` rows on deploy.

Now:
- Final `pnpm test:diff` on the rebased tree, then finish-task commit and PR.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/importers/src/device-providers/provider-descriptors.ts
- packages/importers/test/provider-descriptors.test.ts
- packages/query/src/wearables/origin.ts
- packages/query/src/wearables/selection.ts
- packages/query/src/projection/wearable-summary-projector.ts
- packages/query/test/wearables-candidates-final.test.ts
- packages/cli/src/commands/wearables.ts
- packages/vault-usecases/src/testing/junction-wearable-fixture.ts
- docs/device-provider-contribution-kit.md
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
