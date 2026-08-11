# Junction scale and blood-pressure vault awareness

Status: implementation complete; final exact-head CI and required review gates pending
Date: 2026-08-09

## Outcome

Connected scale and blood-pressure data already has canonical Junction ingestion. This change keeps that ingestion architecture intact, adds direct regression proof that readings survive beyond raw evidence artifacts, and teaches Murph that canonical scale and blood-pressure history exists through the existing cached assistant-context snapshot.

## Audit findings

### Supported connection paths

The hosted Junction connect catalog includes device/app routes relevant to scales and cuffs, including Renpho, Beurer, Omron, iHealth, Withings, Garmin, Fitbit, and Apple Health. Apple Health can also carry measurements written by other device apps. Android Health Connect remains a separate mobile-local path rather than a hosted Junction source.

### Junction resource routing

- `body` is a default Junction summary resource.
- `blood_pressure` is a default sparse timeseries resource.
- Standalone `weight` timeseries is intentionally not enabled by default. A live weight notification triggers the existing reconcile floor, which fetches the authoritative `body` summary instead of averaging repeated scale samples or creating duplicate daily readings.
- The audit found one historical-coverage asymmetry outside this prompt-awareness change: body summaries use the full connection-history window while the generic timeseries backfill was capped to 14 days. Draft PR #1523 fixes that separately by reusing the existing resumable resource job for sparse blood-pressure history while retaining the dense-timeseries bound.

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

Blood-test availability was already part of the assistant context snapshot. It includes the latest panel date and directs Murph to `vault-cli blood-test list`; this change adds scale/body and blood-pressure availability to that same navigation-only snapshot rather than introducing a second prompt-time datastore.

## Implementation

- Extended the existing assistant context-snapshot builder to query the canonical metric projection for body weight/body fat and systolic/diastolic blood pressure in the same batched refresh as blood-test and saved-health-context coverage.
- The snapshot injects availability, the latest canonical date, and exact CLI navigation commands, but never injects reading values themselves.
- The prompt requires a canonical vault read before Murph quotes, compares, or interprets a value. Raw Junction artifacts may not substitute for canonical history; missing canonical data is treated as an ingestion problem.
- Canonical event-ledger writes already invalidate the snapshot. Bumping the existing snapshot schema from version 5 to version 6 rebuilds previously completed snapshots once, with no second cache, version marker, locking pass, or datastore.

## Invariants preserved

- Canonical event/sample ledgers remain the source of truth.
- Raw provider payloads remain bounded evidence, not an alternate query model.
- No device reading value is copied into the system prompt.
- Blood-pressure pairing is preserved at the event level.
- Concurrent canonical writes keep the existing snapshot dirty-sequence guard and win over a stale background refresh.
- Missing device history adds no prompt text.

## Focused proof

- `packages/vault-usecases/test/junction-scale-blood-pressure-canonicalization.test.ts`
  - imports a Withings scale summary and Omron blood-pressure timeseries through the real Junction importer and core write port;
  - asserts canonical event-ledger records exist;
  - asserts canonical metric points exist with expected units and that systolic/diastolic share one source event.
- `packages/assistant-engine/test/assistant-context-snapshot-device-availability.test.ts`
  - asserts Murph receives canonical read instructions and dates without numeric readings;
  - asserts a snapshot written with the previous schema version is detected and rebuilt once.
- `packages/assistant-engine/test/assistant-context-snapshot.test.ts`
  - retains the existing legacy-cache migration proof and now expects the current version-6 snapshot envelope.

## Verification

Focused commands:

```bash
pnpm --filter @murphai/vault-usecases test -- junction-scale-blood-pressure-canonicalization
pnpm --filter @murphai/assistant-engine test -- assistant-context-snapshot-device-availability
pnpm --filter @murphai/vault-usecases typecheck
pnpm --filter @murphai/assistant-engine typecheck
```

Verification history:

- The first PR-head package-coverage run identified one owned stale assertion that still expected context-snapshot schema version 5; it was updated to version 6.
- Exact-head package, CLI, fixture, build, typecheck, architecture, hygiene, and billing checks passed on commit `1946288349105f1d6c5e391113bd15f5e39b9fb1`.
- That run's viewport failure was unrelated: the named overflow script also executed a manual design-proof capture spec requiring `DESIGN_PROOF_OUTPUT_DIR`. Draft PR #1521 scopes the script to its intended viewport spec and its exact viewport workflow passes.
- That run's app-verification failure was also unrelated: current-main hosted-web expectations failed in `biomarker-design-studies.test.tsx` and `join-invite-page-view.test.ts`; this change touches no web source or test.
- The branch was reconciled without conflicts with `main` at `4d910baed613be48ecf329b0625676a760109b05` before the final exact-head run.
- Draft PR #1523 contains the separately verified sparse blood-pressure historical-backfill correction found by this audit.
- Final exact-head CI and the required preliminary/final ReviewGPT gates remain pending and must be recorded in the pull request before merge.
