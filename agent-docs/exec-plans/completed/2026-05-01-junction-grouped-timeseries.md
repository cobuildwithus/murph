# Junction grouped timeseries fetch

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

Fix Junction timeseries polling so it uses the current grouped timeseries API shape and imports samples from each source group instead of treating the grouped envelope as a single record.

## Scope

In scope:

- Use `/v2/timeseries/{user_id}/{resource}/grouped` for Junction timeseries resources.
- Flatten Junction `groups` payloads into per-sample records with source attribution fields the importer already understands.
- Build source projection keys from Junction user id plus provider/source instance identity when present, with explicit slug-only fallback metadata.
- Sanitize raw provider connection ids, source device/app ids, source names, and account/user/client identity aliases before importer snapshots so raw source identifiers stay transient.
- Preserve pagination, resource allowlists, record limits, and raw grouped payload artifacts.
- Add focused tests/fixtures for grouped steps, distance, heartrate, and hrv.

Out of scope:

- New Junction resources beyond the existing default/opt-in resource set.
- Query policy changes for source prioritization.
- Webhook admin or Link behavior.

## Decisions

- Flatten grouped timeseries at the client boundary so provider job snapshots continue to pass arrays into the existing importer contract.
- Preserve only safe `sourceProviderSlug`, `sourceType`, and opaque `sourceInstanceId` on flattened samples. Raw source names, provider connection ids, account/user ids, device ids, and app ids may be read transiently for hashing/origin resolution but must not pass into importer snapshots.
- Raw artifact content should reflect the sanitized importer snapshot, not the provider response with raw source identifiers.

## State

Now:

- Grouped timeseries fetch/flattening is implemented in the active checkout.
- Source projection keys hash Junction user id, provider connection id, source provider slug, and source device/app identity when present.
- Slug-only fallback keeps the weaker prior basis but marks `sourceInstanceKeyFallback` in sanitized source metadata.
- Security review found raw ids were crossing into importer snapshots; snapshots are now sanitized before import and focused Junction tests assert raw provider/source ids are absent.
- Follow-up reviews found direct raw envelopes could still retain Junction connection/profile display names, account/user aliases, raw snapshot `accountId`, and nested source/provider/device/app/account identity containers; raw snapshot sanitization now minimizes `connections`, `summaries`, and `timeseries`, uses an opaque `jxn_acct_*` envelope account id, and strips sensitive identity keys/containers before recursion.
- Connection source availability metadata strips raw source/provider/device/app/account/user/client keys and names before browser serialization.
- Hosted browser resource counting ignores the fallback metadata key.
- Required coverage review made no edits and found the focused proof adequate.
- Final security recheck found no high/medium findings after the raw-envelope fixes.

Verification:

- Passed: `pnpm --dir packages/importers typecheck`
- Passed: `pnpm --dir packages/importers test:coverage`
- Passed: `pnpm --dir packages/importers exec vitest run test/device-providers-junction.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir packages/device-syncd exec vitest run test/junction-provider.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir packages/device-syncd exec tsc -p tsconfig.json --pretty false --noEmit`
- Passed: `pnpm exec vitest run apps/web/test/device-sync-hosted-wake.test.ts --config apps/web/vitest.config.ts --no-coverage`
- Passed: `pnpm test:smoke`
- Passed: `git diff --check` on the task files.
- Blocked: `pnpm --dir packages/device-syncd test:coverage` stops on unrelated existing `test/store.test.ts` webhook trace retention.
- Blocked: current `pnpm --dir packages/device-syncd typecheck`, `pnpm --dir apps/web typecheck`, and root `pnpm typecheck` stop on unrelated active credential-union type drift in device-sync/web tests and runtime files referencing removed token fields. `packages/device-syncd typecheck` and `apps/web typecheck` passed earlier in this task before that overlapping row changed the shared types.

Next: no follow-up in this lane. The plan was closed without a scoped commit because the same files contain overlapping uncommitted Junction/provider-contract edits from the shared checkout.

## Working Set

```txt
packages/device-syncd/src/providers/junction-client.ts
packages/device-syncd/src/providers/junction.ts
packages/device-syncd/test/junction-provider.test.ts
packages/importers/src/device-providers/import-device-provider-snapshot.ts
packages/importers/src/device-providers/junction.ts
packages/importers/src/device-providers/junction-origin.ts
packages/importers/src/device-providers/types.ts
packages/importers/test/device-providers-junction.test.ts
agent-docs/exec-plans/completed/2026-05-01-junction-grouped-timeseries.md
agent-docs/exec-plans/active/COORDINATION_LEDGER.md
```
Completed: 2026-05-01
