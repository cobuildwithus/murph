# Junction Timeseries Defaults

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

Make `steps`, `distance`, `calories_active`, `heartrate`, and `weight` part of
Junction's code-owned default timeseries set while preserving the bounded
storage modes already implemented for each resource.

## Success criteria

- An omitted runtime resource configuration selects all five resources.
- `steps` and `distance` remain provider-scoped daily aggregates.
- `calories_active` and `heartrate` remain bounded hourly features with no raw
  sample retention.
- `weight` remains a sparse per-reading measurement with long history.
- Maximum collection fanout is explicit and covered by deterministic tests.
- Runtime docs, public changelog, PR description, and exact-head review agree
  with the shipped default behavior.

## Scope

- In scope: shared resource defaults, naming/docs/tests that describe the
  policy, focused collection-fanout proof, changelog, PR review and CI.
- Out of scope: new configuration flags, raw timeseries storage, schema
  changes, provider concurrency, or a second resource-policy owner.

## Constraints

- Keep the contracts resource list as the single source of truth.
- Reuse the existing daily, hourly, and sparse-history collectors unchanged.
- Preserve explicit empty and exact explicit runtime overrides.
- Keep provider calls sequential and database work bounded.

## Risks and mitigations

1. Default collection adds five Junction requests per closed day.
   Mitigation: retain one-day chunking, sequential fetches, yield boundaries,
   and add exact maximum-window request-count proof.
2. Dense provider rows could become durable raw data.
   Mitigation: retain existing aggregate-only normalization and focused no-raw
   retention tests.
3. User-visible release text could overstate history or granularity.
   Mitigation: describe daily/hourly/per-reading behavior precisely and verify
   the changelog fragment with its loader tests.

## Tasks

1. Give the revised requirement and fanout constraints to the existing
   ReviewGPT implementation thread and obtain a patch.
2. Inspect and apply only the smallest correct patch.
3. Add or correct deterministic default-path, aggregation, history, and
   collection-fanout tests.
4. Update runtime docs, changelog, and PR description.
5. Run focused tests and typechecks, inspect the full diff, and commit/push.
6. Run required exact-head CI and the explicitly continued final ReviewGPT
   audit, resolve findings, and finish the plan at a green reviewed head.

## Verification

- Focused contracts/importers/device-syncd tests for default admission and
  resource behavior.
- Deterministic Junction request-count proof at the 14-day backfill and 7-day
  reconcile bounds.
- Changelog fragment validation.
- Relevant package typechecks.
- Exact-head required GitHub checks and final ReviewGPT pass.
Completed: 2026-08-12
