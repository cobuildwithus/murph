# Remove dense wearable timeseries raw retention

Status: active
Created: 2026-06-06
Updated: 2026-06-06

## Goal

- Stop normal wearable sync from storing full dense provider timeseries arrays
  in vault raw artifacts.
- Keep product-useful compact facts such as daily `spo2`, `lowest-spo2`, and
  `stress-level`.
- Keep assistant and conversation work independent of background device-sync
  storage cleanup.

## Target rule

Provider timeseries may be fetched and used in memory to compute compact daily
facts. The full sample array should not be persisted by default. The vault
should keep product facts and small evidence artifacts, not giant
`junction-timeseries-*` JSON payloads.

This is a hard ingestion boundary, not just a storage cleanup:

```text
provider summaries
  -> persist summary artifact
  -> canonical observations / sessions

provider compact timeseries only: blood_oxygen, stress_level
  -> aggregate in memory
  -> persist tiny aggregate artifact
  -> canonical daily observations

dropped dense timeseries
  -> not requested
  -> webhook = no-op or bounded freshness hint
  -> never passed to generic snapshot import
```

## Current problem

- Junction defaults include dense timeseries resources such as `heartrate`,
  `hrv`, `steps`, `distance`, `calories_active`, and `respiratory_rate`, plus
  `blood_oxygen` and `stress_level`.
- `device-syncd` fetches those resources during backfill and reconcile. The
  importer writes every timeseries payload as a raw artifact before deriving
  only a few compact observations.
- Query and search already ignore raw-only timeseries, so most dense retention
  is storage/debug residue rather than product truth.
- Core stores raw artifacts as plain JSON. Current dense retention preserves
  recent artifacts by default, so fresh syncs can still create large vaults.

## Success criteria

- Junction default sync no longer requests raw-only dense resources:
  `heartrate`, `hrv`, `steps`, `distance`, `calories_active`, and
  `respiratory_rate`.
- Junction default timeseries resources are explicit and limited to
  `blood_oxygen` and `stress_level`; defaults must not be built from every
  policy row.
- Junction `timeseriesResources: []` disables timeseries instead of falling
  back to defaults.
- Junction `weight` is not default unless the implementation first maps it to a
  compact body observation and tiny compact artifact.
- Activity, sleep, readiness, body, session, and workout summaries remain the
  source for normal daily facts.
- Junction `blood_oxygen` and `stress_level` still produce the same compact
  daily observations.
- The Junction normalizer does not write full
  `junction-timeseries-blood-oxygen`, `junction-timeseries-stress-level`, or
  other full `junction-timeseries-*` artifacts for the default path.
- Retained compact timeseries events reference a staged compact artifact role,
  and every `event.rawArtifactRoles[]` entry exists in `rawArtifacts[].role`.
- The importer fallback does not replace deleted dense artifacts with a full
  generic `provider-snapshot` artifact, including non-empty aggregate inputs
  with zero valid samples.
- Junction webhooks for dropped dense resources do not serialize or chunk direct
  provider payloads into durable jobs.
- Direct Oura no longer imports dense `/heartrate` data during normal
  backfill, reconcile, or explicit resource jobs.
- New Oura connections do not request the `heartrate` scope or subscribe to
  `heartrate` webhooks by default.
- Existing Oura accounts that still have the old `heartrate` grant or old
  provider-side webhook subscription still do not fetch, import, or store
  heartrate.
- Existing recent dense raw artifacts can be removed by a one-time cleanup path.

## Scope

In scope:

- Junction default resource selection and resource-list normalization.
- Junction webhook handling for timeseries resources.
- Junction timeseries normalization and raw artifact shaping.
- Direct Oura dense heartrate fetch/import paths, default scopes, and webhook
  targets.
- Direct Oura old-grant and old-webhook no-op behavior.
- Focused docs and tests for the storage-retention boundary.
- One-time cleanup for existing dense raw artifacts, including recent artifacts.

Out of scope:

- Compression as a substitute for deletion.
- A longer retention window tweak as the primary fix.
- A new scheduler, service, queue, or mailbox lane.
- Query UX redesign.
- Broad provider registry rewrites unrelated to this retention boundary.

## Constraints

- Default to deletion and radical simplicity.
- Do not persist provider firehose payloads by default.
- Preserve core import invariants: staged raw artifacts, raw artifact roles, and
  event references must stay consistent.
- Provider credentials, raw payloads, account identifiers, and secrets must not
  be logged, documented, or fixture-copied.
- Provider-specific behavior stays in provider-owned modules.
- Device sync remains background work and must not block fresh assistant
  messages.

## Current architecture evidence

- `packages/device-syncd/src/providers/junction.ts` derives the normal
  timeseries resource list from Junction defaults, then fetches timeseries for
  backfill and reconcile windows.
- `packages/importers/src/device-providers/junction-resources.ts` includes dense
  timeseries resources in the current default list and classifies them as
  `dense_provider_timeseries`.
- `packages/importers/src/device-providers/junction.ts` normalizes timeseries by
  writing `junction-timeseries-${resourceSlug}` raw artifacts before deriving
  compact observations from `blood_oxygen` and `stress_level`.
- `packages/device-syncd/src/providers/oura.ts` has a dense heartrate import
  path for backfill, reconcile, and resource jobs.
- `packages/importers/src/device-providers/oura.ts` retains raw Oura heartrate
  artifacts.
- `packages/importers/src/device-providers/import-device-provider-snapshot.ts`
  may create a generic full `provider-snapshot` artifact when a normalizer
  returns no raw artifacts.
- `packages/core/src/mutations.ts` requires event raw artifact roles to match
  staged artifacts.
- Query documentation and tests already treat dense wearable telemetry as raw
  evidence/debug data outside default read and search surfaces.

## Proposed architecture

Normal wearable sync should follow this shape:

```text
provider fetch
  -> compact in memory
  -> canonical daily observations
  -> tiny compact aggregate artifact for retained compact timeseries
  -> no persisted full timeseries array
```

Raw-only dense provider telemetry should either not be fetched or should be
treated as a freshness hint. It should not become default vault storage.

For `blood_oxygen` and `stress_level`, emit one small compact aggregate raw
artifact. Do not add a broad fallback-suppression abstraction unless a failing
test proves it is needed. The compact artifact keeps current core/importer
invariants simple, gives events a real evidence role, and avoids triggering the
generic full `provider-snapshot` fallback.

## Migration

1. Split Junction resource-list normalization:
   - summaries remain required and use defaults when omitted;
   - timeseries treat `undefined` as defaults and explicit `[]` as disabled;
   - unsupported configured resources still throw.

2. Define Junction default timeseries explicitly as:

   ```ts
   ["blood_oxygen", "stress_level"] as const
   ```

   Do not build defaults by mapping every timeseries policy row.

3. Remove raw-only dense Junction timeseries from normal sync defaults:
   `heartrate`, `hrv`, `steps`, `distance`, `calories_active`, and
   `respiratory_rate`.

4. Keep only currently useful aggregate Junction timeseries in defaults:
   `blood_oxygen` and `stress_level`, because they produce daily `spo2`,
   `lowest-spo2`, and `stress-level` observations.

5. Remove `weight` from defaults unless the same patch maps it to a compact
   body observation plus tiny compact artifact. Sparse is not enough by itself;
   the default rule is product fact or delete.

6. Change Junction `blood_oxygen` and `stress_level` normalization to aggregate
   in memory and stop writing full `junction-timeseries-blood-oxygen` or
   `junction-timeseries-stress-level` artifacts.

7. For aggregate resources, write a tiny compact artifact such as
   `junction-timeseries-daily-blood-oxygen` or
   `junction-timeseries-daily-stress-level`. It should contain only fields such
   as day, source, sample count, mean/min/final values, and timestamps. It must
   not include the full sample array, nested provider object, per-sample ids, or
   unbounded arrays.

8. Create the compact artifact role before event emission. Aggregated events
   must reference the compact role, for example
   `junction-timeseries-daily-${resourceSlug}`, not the removed full
   `junction-timeseries-${resourceSlug}` role. Do not leave dangling raw
   artifact references.

9. Ensure compact aggregate paths never trigger the full generic
   `provider-snapshot` fallback, including non-empty `blood_oxygen` or
   `stress_level` payloads with zero valid samples.

10. Gate Junction webhook direct payload jobs before serialization or chunking.
    Dropped dense/raw-only timeseries must not create `webhookDataJson` jobs.
    For those resources, use no-op or a bounded reconcile freshness hint.

11. Allow direct payload import for `blood_oxygen` and `stress_level` only when
    it goes through the same compact aggregation path and stays under the
    compact artifact byte ceiling. If that is not needed, treat those webhooks
    as bounded freshness hints too.

12. Stop direct Oura dense heartrate import:
    - remove the normal backfill/reconcile/resource-job heartrate fetch path;
    - delete or make unreachable `importOuraDenseDailySnapshots`;
    - delete or make empty/unreachable `OURA_DENSE_DATA_TYPES`;
    - remove or make unreachable the `heartrate` resource descriptor;
    - remove `heartrate` from default scopes for new Oura connections;
    - remove `heartrate` from default webhook targets;
    - make old `heartrate` webhook resource jobs no-op safely;
    - keep daily activity, sleep, readiness, SpO2, session, and workout imports.

13. Check Oura webhook subscription upkeep. If old managed `heartrate`
    subscriptions are pruned by existing ensure behavior, keep that behavior
    small and explicit. Either way, the runtime no-op defense must remain,
    because old provider-side webhooks can survive deploy skew.

14. Update docs that currently say Junction dense timeseries are retained raw
    evidence/debug data. The new durable rule is compact aggregate evidence only
    for `blood_oxygen` and `stress_level`; dropped dense resources are not
    normal raw evidence.

15. Run a one-time cleanup for existing dense raw artifacts, including recent
    artifacts. Existing hosted dense retention excludes recent artifacts by
    default, so the cleanup must use the explicit recent-dense path after
    producer removal.

16. After the producer removal has shipped and cleanup has run, keep dense
    retention only as legacy cleanup or delete it if no longer needed.

## Tests to require

- Junction default sync no longer requests raw-only dense timeseries.
- `timeseriesResources: []` disables timeseries instead of falling back to
  defaults.
- Junction default timeseries are exactly `blood_oxygen` and `stress_level`.
- `weight` is absent from defaults unless it has a compact body observation
  mapping in the same patch.
- Blood oxygen and stress still produce the same daily observations.
- No full `junction-timeseries-blood-oxygen`,
  `junction-timeseries-stress-level`, `junction-timeseries-heartrate`, or
  generic `provider-snapshot` is written for the compact paths.
- A non-empty `blood_oxygen` or `stress_level` payload with zero valid samples
  does not write full `provider-snapshot` or full `junction-timeseries-*`.
- Every `event.rawArtifactRoles[]` entry exists in `rawArtifacts[].role`.
- Compact aggregate artifacts stay small and contain no full `data` array.
- Compact aggregate artifacts contain no `records`, `items`, nested provider
  object, per-sample ids, or arrays longer than a tiny fixed bound.
- Junction webhook direct payload jobs are not created for dropped raw-only
  dense resources.
- Oura reconcile, backfill, and resource jobs do not call `/heartrate`.
- Existing Oura accounts with old `heartrate` scopes still do not call
  `/heartrate`.
- Old Oura `heartrate` webhooks are accepted or ignored safely and do not import
  heartrate.
- Query wearable summaries remain unchanged for Oura and Junction summary
  facts.
- Legacy dense raw cleanup deletes recent dense artifacts during the one-time
  migration path.

## Risks and mitigations

1. Risk: a provider only exposes a useful daily fact through timeseries.
   Mitigation: keep only proven useful aggregate resources in defaults, and add
   a failing test before retaining any additional timeseries resource.

2. Risk: compact aggregate artifacts accidentally retain the full nested
   payload.
   Mitigation: add tests that assert no `data`, `records`, `items`, nested
   provider object, per-sample ids, or unbounded arrays, and enforce a small
   fixture byte ceiling.

3. Risk: deleting raw artifacts breaks core raw artifact role invariants.
   Mitigation: create compact aggregate artifacts before event emission and add
   an invariant test that every event role has a staged raw artifact.

4. Risk: existing Oura connections may still have the old `heartrate` grant.
   Mitigation: stop using the grant in code first, make old heartrate resource
   jobs no-op, and request less scope only for new connections.

5. Risk: old runtimes continue writing dense raw during a staggered deploy.
   Mitigation: deploy producer removal before running cleanup, then run cleanup
   after all relevant runtimes are updated.

6. Risk: deleting all raw artifacts for an aggregate path triggers the generic
   full `provider-snapshot` fallback.
   Mitigation: make compact aggregate artifacts mandatory for retained compact
   timeseries and test invalid/zero-valid-sample payloads.

## Verification

- Run focused tests for Junction resource defaults, Junction importer
  normalization, Junction webhooks, Oura provider jobs, Oura importer behavior,
  and dense raw cleanup.
- Run the repo's diff-aware verification for all touched provider/importer/core
  paths.
- Run typecheck for touched packages when code changes land.
- Locally connect or replay a Junction-backed source and an Oura source, then
  prove:
  - sync drains normally;
  - compact daily facts still appear;
  - no new full dense `junction-timeseries-*` or Oura heartrate raw artifacts
    are written;
  - vault raw size remains bounded after sync.

## Deployment concerns

- Producer removal should deploy before or with cleanup.
- Cleanup should run only after the updated producer code is active everywhere
  that can write wearable raw artifacts.
- If deploys are staggered, old runtimes may keep writing dense raw until they
  are updated; rerun cleanup after the deploy window if needed.

## Open questions

- Should `blood_oxygen` and `stress_level` stay enabled for every
  Junction-backed source, or only for sources proven to support those resources?
- Should Oura `heartrate` parser compatibility remain temporarily for old raw
  artifacts, or be removed in the same patch once producers are gone?
