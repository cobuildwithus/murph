# Device Provider Contribution Kit

Last verified: 2026-04-03

## Purpose

This guide is the maintainer playbook for adding a new wearable or health-data provider to Murph.

Use it when you need to land a provider end to end:
- shared provider metadata in `@murphai/importers`
- transport and lifecycle in `@murphai/device-syncd`
- snapshot normalization in `@murphai/importers`
- docs, tests, and optional hosted or onboarding wiring

Start here, then use:
- [`./device-provider-compatibility-matrix.md`](./device-provider-compatibility-matrix.md)
- [`./templates/README.md`](./templates/README.md)

## Current provider architecture

Murph intentionally splits provider work across four seams.

### 1. Shared provider metadata lives in `@murphai/importers`

`packages/importers/src/device-providers/provider-descriptors.ts` is the single shared source for:
- provider key and display name
- transport modes
- OAuth callback path and default scopes
- webhook path and delivery mode
- sync windows and supported job kinds
- normalization families and parser expectations
- source-priority hints

Both `packages/device-syncd` and `packages/importers` consume that descriptor surface. New providers should extend it instead of inventing a second metadata shape.

### 2. `packages/device-syncd` owns transport and lifecycle

`device-syncd` owns:
- connect URLs and OAuth callback completion
- token refresh and disconnect behavior
- scheduled backfill and reconcile jobs
- optional webhook verification and fan-in
- local token storage and runtime state outside the vault

The runtime provider object should expose the shared `descriptor` plus behavior hooks only. Do not mirror callback paths, webhook paths, default scopes, or other lifecycle metadata onto extra top-level runtime fields.

If you need the same callback or webhook behavior on a different HTTP surface, reuse `@murphai/device-syncd/public-ingress` instead of forking provider-specific ingress logic.

### 3. `packages/importers` owns parsing and normalization

Importer adapters own:
- snapshot validation and parsing
- raw-evidence retention under `raw/integrations/**`
- conversion into `DeviceBatchImportPayload`
- canonical event, sample, and provenance shaping

Provider adapters should consume the same shared descriptor metadata that `device-syncd` uses.

### 4. `packages/core` remains the only canonical writer

Provider code must not write vault files directly.

The intended path is:
1. `device-syncd` fetches or receives upstream provider data.
2. `device-syncd` hands one provider snapshot to `context.importSnapshot()`.
3. `@murphai/importers` normalizes that snapshot into a device batch.
4. `@murphai/core` performs the canonical write.

That split is the main guardrail for provider contributions. Treat shared metadata, transport, and normalization as separate deliverables even when the same person lands all three in one patch.

## Non-negotiables

- Keep provider credentials outside the canonical vault.
- Keep stored runtime metadata shallow and sanitized; do not persist large nested profile payloads into account metadata.
- Preserve useful upstream evidence as raw artifacts when it helps replay, audit, or future re-normalization.
- Reuse existing canonical event kinds, sample streams, and metric names before inventing new ones.
- If a provider supports webhooks, treat them as routing or freshness hints that enqueue work; normalization still happens through importer snapshots.
- Reuse the shared descriptor and shared registry helper; do not reintroduce provider metadata drift between `device-syncd` and `importers`.
- If you need a hosted or alternate HTTP surface, build it on top of `@murphai/device-syncd/public-ingress` rather than duplicating callback or webhook verification logic.

## Required touchpoints

Most first-class provider additions touch both package seams plus a small set of tests and docs.

### Shared metadata and importer seam

- `packages/importers/src/device-providers/provider-descriptors.ts`
- `packages/importers/src/device-providers/defaults.ts`
- `packages/importers/src/device-providers/<provider>.ts`
- `packages/importers/src/device-providers/index.ts`
- `packages/importers/test/provider-descriptors.test.ts`
- relevant importer tests for the new provider

### `device-syncd` transport seam

- `packages/device-syncd/src/providers/<provider>.ts`
- `packages/device-syncd/src/config.ts`
- `packages/device-syncd/src/index.ts`
- `packages/device-syncd/test/provider-descriptor-integration.test.ts`
- relevant `device-syncd` tests for auth, jobs, webhook flow, and runtime behavior

### Usually required when the provider should be a first-class published surface

- `packages/device-syncd/src/public-ingress.ts` when the provider should participate in shared callback or webhook ingress exports
- `packages/device-syncd/package.json` for a `./providers/<provider>` export
- `packages/importers/package.json` only if a new importers subpath is needed beyond the existing device-provider surfaces

### Docs and operator surfaces

- `packages/device-syncd/README.md`
- `packages/importers/README.md`
- `README.md` when provider guidance or maintainer routing would otherwise be misleading
- this contribution kit or the compatibility matrix when the provider changes the shared planning surface

### Optional follow-up touchpoints

Update these only when the provider should appear there now:
- `apps/web/src/lib/device-sync/**`
- `packages/cli/src/setup-cli.ts`
- `packages/cli/src/setup-wizard.ts`
- onboarding or hosted settings docs

## Recommended build order

### 1. Scope the first slice

Before writing code, decide the first supported families using the compatibility matrix.

Do not start by chasing every endpoint the provider offers. Prefer the smallest useful slice that still feels first-class for Murph, for example:
- profile or account identity
- sleep summary
- daily activity totals
- readiness or recovery
- workout sessions

Questions to answer first:
- Is the provider polling-first, webhook-first, or both?
- Which lifecycle metadata belongs in the shared descriptor?
- Which collections need true backfill versus a short rolling reconcile window?
- Which metric families fit Murph's current canonical shapes today?
- Which unsupported sections should still be retained as raw artifacts?

### 2. Add the shared descriptor first

Before writing transport or normalization code, add a new descriptor to `packages/importers/src/device-providers/provider-descriptors.ts`.

Define at least:
- `provider`
- `displayName`
- `transportModes`
- `oauth` and `webhook` metadata when applicable
- `sync` windows and job kinds
- `normalization.metricFamilies`
- `sourcePriorityHints`

Then:
- add the descriptor to `defaultDeviceProviderDescriptors`
- export it through `packages/importers/src/device-providers/defaults.ts`
- use that descriptor as the single metadata source for both the adapter and `device-syncd` provider

If transport code and normalization code need different metadata, that is usually a sign the descriptor should be expanded rather than duplicated.

### 3. Add the `device-syncd` provider

Use the template in [`./templates/device-sync-provider.template.md`](./templates/device-sync-provider.template.md).

The provider implementation should:
- import the shared descriptor
- derive its runtime `descriptor` from the shared descriptor
- implement OAuth exchange and token refresh when required
- implement scheduled jobs with bounded reconcile windows
- keep webhook handlers light: verify, parse, dedupe, and enqueue
- fetch one provider snapshot inside `executeJob()` and hand that snapshot to `context.importSnapshot()`

Do not widen the runtime provider shape with duplicated metadata fields. Shared lifecycle metadata belongs in `descriptor`; the runtime provider surface should own behavior only.

Strong recommendations:
- Treat `externalAccountId` as the stable cross-job identity boundary.
- Use explicit job kinds such as `backfill`, `reconcile`, `resource`, or `delete`.
- Keep webhook fan-in small and retry-safe; enqueue work instead of normalizing inline.
- Reuse `@murphai/device-syncd/public-ingress` instead of inventing a second callback or webhook surface.

### 4. Add the importer adapter

Use the template in [`./templates/device-provider-adapter.template.md`](./templates/device-provider-adapter.template.md).

The adapter should:
- import and spread the shared descriptor
- validate the upstream snapshot at the boundary, ideally with `zod`
- preserve useful raw upstream payloads
- emit normalized events, samples, and provenance
- create stable provider-specific `externalRef` values
- avoid synthesizing precision the provider did not actually send

Strong recommendations:
- Reuse `makeNormalizedDeviceBatch()` and the helpers in `shared-normalization.ts`.
- Retain unsupported-but-useful upstream sections as `snapshot-section:*` raw artifacts instead of silently discarding them.
- Prefer existing event kinds such as `observation`, `sleep_session`, and `activity_session`.
- Prefer existing sample streams such as `heart_rate`, `hrv`, `respiratory_rate`, `sleep_stage`, `steps`, and `temperature`.
- If you need a new metric family or stream, update the compatibility matrix in the same patch.

### 5. Wire config, defaults, exports, and tests

After the provider and adapter exist, wire them into the normal repo seams.

#### `device-syncd`

- add config readers and env handling in `packages/device-syncd/src/config.ts`
- export the provider from `packages/device-syncd/src/index.ts`
- add a `packages/device-syncd/package.json` provider subpath when the provider should be imported directly
- add or extend provider tests covering auth, refresh, missing account identity, job execution, and webhook behavior
- extend `packages/device-syncd/test/provider-descriptor-integration.test.ts` when the new provider should prove descriptor alignment

#### `importers`

- add the adapter to `packages/importers/src/device-providers/defaults.ts`
- export it from `packages/importers/src/device-providers/index.ts`
- extend importer tests for parsing, evidence retention, and canonical mapping
- extend `packages/importers/test/provider-descriptors.test.ts` when the provider should prove descriptor alignment

Do not add a second bespoke registry. Both packages already share the keyed registry helper from `provider-descriptors.ts`.

### 6. Decide whether hosted or onboarding surfaces need the provider now

If the provider should also work in hosted settings or control-plane surfaces, wire it into the relevant `apps/web` device-sync helpers.

If the provider should appear in local onboarding or setup flows, update the CLI setup surfaces.

Keep this optional. A provider can land first in the local daemon-plus-importer path and only later join hosted or onboarding UX.

### 7. Update docs

At minimum:
- document the provider in `packages/device-syncd/README.md`
- document the adapter in `packages/importers/README.md`
- update any maintainer or operator lists that would otherwise become misleading

If the provider adds a new metric family, naming pattern, or normalization convention, update the compatibility matrix in the same change.

## Contribution checklist

Use this as the merge checklist for a new provider.

### Descriptor and shared metadata

- [ ] The provider has one shared descriptor in `provider-descriptors.ts`.
- [ ] The descriptor covers transport, sync, normalization, and source-priority hints.
- [ ] Both the adapter and `device-syncd` provider consume that shared descriptor instead of duplicating metadata.
- [ ] The provider is added to `defaultDeviceProviderDescriptors`, and related exports are updated.

### Transport and auth

- [ ] Provider config exists with explicit defaults and timeout or reconcile settings.
- [ ] OAuth or auth flow resolves a stable `externalAccountId`.
- [ ] Access and refresh token behavior is implemented and bounded.
- [ ] Disconnect or revocation behavior is explicit when the provider supports it.
- [ ] Webhook verification exists only when the provider truly supports it.
- [ ] Webhook handlers enqueue work instead of performing heavy normalization inline.

### Scheduling and jobs

- [ ] Initial connect schedules an explicit backfill or seed job.
- [ ] Reconcile scheduling uses bounded windows and dedupe keys.
- [ ] Provider job kinds are explicit and descriptor-aligned.
- [ ] `executeJob()` builds a provider snapshot and passes it through importer normalization.

### Normalization and evidence

- [ ] Snapshot parsing validates the provider boundary.
- [ ] Raw upstream evidence is retained when it supports replay or future re-normalization.
- [ ] Canonical event kinds and sample streams reuse existing Murph names whenever possible.
- [ ] `externalRef` values are stable and provider-specific.
- [ ] Unsupported-but-useful sections are retained as raw artifacts instead of silently discarded.
- [ ] Profile or account metadata does not copy large nested provider payloads into runtime metadata.

### Wiring and docs

- [ ] `device-syncd` config and exports are wired.
- [ ] importer defaults and exports are wired.
- [ ] shared registry usage remains on the existing helper rather than a bespoke registry.
- [ ] package READMEs mention the provider or the new maintainer surface.
- [ ] hosted or onboarding surfaces are updated when the provider should appear there now.
- [ ] the compatibility matrix is updated if the provider introduces a new family or naming pattern.

### Verification

- [ ] Focused provider tests run for both touched package seams.
- [ ] Repo-level verification runs before merge.
- [ ] Failure cases cover auth errors, token refresh, missing account identity, and malformed snapshots.
- [ ] Webhook providers have verification, dedupe, and unknown-account coverage.
- [ ] Descriptor-alignment tests are updated when the provider becomes a built-in first-class surface.

## Verification commands

For a tight local loop while building the provider:

```bash
pnpm --dir packages/device-syncd typecheck
pnpm --dir packages/device-syncd test
pnpm --dir packages/importers typecheck
pnpm --dir packages/importers test
```

Before merge, run the repo baselines documented in the testing map:

```bash
pnpm typecheck
pnpm test
pnpm test:coverage
```

## Current reference providers

Use the existing providers as concrete examples of different integration shapes:
- Garmin: OAuth plus polling-first reconcile, activity detail descriptors, and women-health support
- WHOOP: OAuth plus webhooks, recovery and workout payloads, and delete fan-in
- Oura: OAuth plus polling-first reconcile, optional webhook verification and admin support, and rich daily readiness or sleep families

Study those implementations before inventing a new provider-specific pattern.
