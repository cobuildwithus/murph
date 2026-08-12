# Junction resource policy and sparse history

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Give every resource in the current 57-resource Junction wearable audit scope
  one explicit static policy and extend initial history for the currently
  supported sparse P1/P2 resources, without retaining full provider timeseries
  or adding a runtime registry.

## Success criteria

- One checked-in 57-resource inventory has an exact one-to-one policy mapping.
- Existing defaults, allowlists, webhook recognition, and history behavior derive
  from that policy instead of duplicated arrays.
- VO2 max, temperature resources, caffeine, heart-rate recovery, breathing
  disturbance, and AFib burden receive bounded long initial history.
- Sparse history uses bounded multi-day fetches and a tested fanout ceiling; it
  never emits canonical samples or full-timeseries evidence.
- Focused contract, importer, and device-sync tests and typechecks pass.
- A ReviewGPT implementation pass and both required PR review gates complete.

## Scope

- In scope: static catalog/policy ownership; derived resource sets; sparse-history
  selection, chunking, continuation, and coverage; exact drift tests; current docs.
- Out of scope: canonicalizers for newly admitted resources, raw workout streams,
  waveform retention, production telemetry services, or database/schema changes.

## Constraints

- Technical constraints: keep current package dependency direction; reuse existing
  resource jobs and per-source coverage owner; cap composed provider calls at the
  maximum admitted source cardinality; retain only existing compact daily facts.
- Product/process constraints: health-data sensitive; synthetic fixtures only;
  no full timeseries, raw payload arrays, direct identifiers, or new state owner.

## Risks and mitigations

1. Risk: extending eight sparse resources through the one-day fetch loop creates
   thousands of provider calls.
   Mitigation: use policy-owned multi-day chunks plus a bounded continuation and
   prove maximum-source fanout in tests.
2. Risk: a catalog snapshot merely mirrors Murph and does not detect vendor drift.
   Mitigation: compare the policy inventory against both runtime resource enums
   exported by the pinned Junction SDK, with explicit non-wearable exclusions and
   provider alias normalization. An SDK upgrade with an unclassified value fails.
3. Risk: feature branches duplicate or conflict with resource ownership.
   Mitigation: land this as the shared stacked base and have each feature branch
   edit only its policy entries and canonicalizer.

## Tasks

1. Ask ReviewGPT for an implementation proposal/patch against this exact branch.
2. Implement the static policy inventory and derive existing resource surfaces.
3. Implement bounded sparse-history windows and completion behavior.
4. Add load, drift, retry, admission-fence, and no-raw-retention tests.
5. Update device-provider architecture/compatibility documentation.
6. Run focused verification, commit, push, open the stacked-base PR, and run CI
   plus preliminary/final ReviewGPT gates.

## Decisions

- Keep `electrocardiogram_voltage` explicitly excluded/derived-only and
  `workout_stream` explicitly dedicated; this PR does not make either fetchable.
- Use 180 days for currently supported sparse wellness resources and keep dense
  resources on their existing short windows.
- Preserve the existing configured blood-pressure and note history length and
  daily chunks; only the eight newly extended sparse aggregate resources use the
  policy-owned 180-day history and 30-day provider windows.
- Limit composed sparse-history scheduling to eight resource/source jobs per
  reconcile and rotate deterministic pages without adding a persisted cursor.
- Anchor catalog drift to the SDK's client-facing and timeseries runtime enums;
  a new or renamed SDK value requires a policy or explicit non-wearable decision.

## Progress

- Implemented the 57-resource static policy and all derived runtime surfaces.
- Added independent SDK catalog-drift sentinels and non-divisible tail coverage
  for the eight-job global scheduling cap.
- Added bounded 30-day continuation behavior for the eight sparse resources and
  preserved existing blood-pressure/note behavior.
- Focused contract, importer, device-sync, config, manifest, boundary, and package
  typechecks are green; ReviewGPT and PR-lane gates remain for the parent lane.

## Verification

- Commands to run: focused contract/importer/device-sync tests and package
  typechecks; package-boundary tests; repository privacy/secret scans; PR CI.
- Expected outcomes: exact catalog equality, bounded call count, complete/retry
  coverage, stable derived arrays, zero canonical samples/full-timeseries artifacts,
  and green required checks on the pushed head.
Completed: 2026-08-11
