# Junction scale and blood-pressure vault awareness

Status: completed implementation; exact-head CI pending
Date: 2026-08-09

## Outcome

Connected scale and blood-pressure data already has canonical Junction ingestion. This change keeps that ingestion architecture intact, adds direct regression proof that the readings survive beyond raw evidence artifacts, and teaches Murph that the canonical history exists through the existing cached assistant-context snapshot.

## Audit findings

### Supported connection paths

The hosted Junction connect catalog includes device/app routes relevant to scales and cuffs, including Renpho, Beurer, Omron, iHealth, Withings, Garmin, Fitbit, and Apple Health. Apple Health can also carry measurements written by other device apps. Android Health Connect remains a separate mobile-local path rather than a hosted Junction source.

### Junction resource routing

- `body` is a default Junction summary resource.
- `blood_pressure` is a default sparse timeseries resource.
- Standalone `weight` timeseries is intentionally not enabled by default. A live weight notification triggers the existing reconcile floor, which fetches the authoritative `body` summary instead of averaging repeated scale samples or creating duplicate daily readings.

### Canonical vault storage

The importer separates queryable canonical records from supporting evidence:

- Junction `body` summaries become canonical observations such as `weight`, `bmi`, `body-fat-percentage`, `lean-body-mass`, and `waist-circumference`.
- Each Junction blood-pressure reading becomes one canonical `measurement` event containing both `systolic-blood-pressure` and `diastolic-blood-pressure` entries in `mmHg`.
- Compact Junction evidence parts and the raw-ingest receipt remain attached for provenance and replay, but are not the only stored representation.
- Core `importDeviceBatch` persists those events into the canonical event ledger, from which the query projection emits `body-weight`, `systolic-blood-pressure`, and `diastolic-blood-pressure` metric points.

### Murph read surfaces

- Scale/body summaries: `vault-cli wearables body list --limit 30 --format json`.
- Generic body measurement fallback: `vault-cli measurement list --from <date> --limit 100 --format json`.
- Blood pressure: `vault-cli measurement list --from <date> --limit 100 --format json`, then inspect systolic and diastolic entries from the same event.

The generic `wearables metric` summary route is not used for blood pressure because its summary bundle has no paired blood-pressure fields. The canonical measurement surface is the truthful read path and preserves pairing.

### Existing blood-test awareness

Blood-test availability was already part of the assistant context snapshot. It includes the latest panel date and directs Murph to `vault-cli blood-test list`; this change composes scale/body and blood-pressure availability into that same navigation-only snapshot instead of introducing a second prompt-time datastore.

## Implementation

- Added a small device-availability snapshot composer that queries the canonical metric projection for body weight/body fat and systolic/diastolic blood pressure.
- The composer injects availability, the latest canonical date, and exact CLI navigation commands, but never injects the reading values themselves.
- The block explicitly requires a canonical read before Murph quotes, compares, or interprets a value and forbids raw Junction artifacts as the normal read path.
- The existing snapshot file stores a small composer-version marker. Canonical event-ledger writes already invalidate the base snapshot; the public refresh facade then rebuilds the base snapshot and recomposes device availability under the same runtime write lock.
- Completed snapshots from before this change are lazily migrated without requiring a canonical data rewrite.

## Invariants preserved

- Canonical event/sample ledgers remain the source of truth.
- Raw provider payloads remain bounded evidence, not an alternate query model.
- No device reading value is copied into the system prompt.
- Blood-pressure pairing is preserved at the event level.
- Concurrent canonical writes win: the composer refuses to publish if the snapshot dirty sequence changes during its read.
- Missing device history adds no prompt text.

## Focused proof

- `packages/vault-usecases/test/junction-scale-blood-pressure-canonicalization.test.ts`
  - imports a Withings scale summary and Omron blood-pressure timeseries through the real Junction importer and core write port;
  - asserts canonical event-ledger records exist;
  - asserts canonical metric points exist with expected units and that systolic/diastolic share one source event.
- `packages/assistant-engine/test/assistant-context-snapshot-device-availability.test.ts`
  - asserts Murph receives the canonical read instructions and dates without the numeric readings;
  - asserts an already-completed pre-composer snapshot is detected and migrated once.

## Verification

Run:

```bash
pnpm --filter @murphai/vault-usecases test -- junction-scale-blood-pressure-canonicalization
pnpm --filter @murphai/assistant-engine test -- assistant-context-snapshot-device-availability
pnpm --filter @murphai/vault-usecases typecheck
pnpm --filter @murphai/assistant-engine typecheck
```

Record exact-head CI and any required review-gate evidence in the pull request before merge.
