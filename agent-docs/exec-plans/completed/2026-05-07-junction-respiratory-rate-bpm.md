# Junction Respiratory Rate BPM Unit

## Goal

Reproduce and fix the Junction device-sync failure where `respiratory_rate`
timeseries entries with upstream `unit: "bpm"` become core samples rejected as
unsupported for the `respiratory_rate` stream.

## Scope

- Junction importer normalization for respiratory-rate timeseries units.
- Focused tests proving the local reproduction and normalized output.
- Avoid changing chat typing or active-turn behavior unless investigation shows
  the device-sync failure is still coupled to assistant input handling.

## Constraints

- Preserve core sample stream invariants: canonical respiratory-rate samples use
  `breaths_per_minute`.
- Do not broaden heart-rate `bpm` semantics across unrelated streams.
- Preserve raw Junction artifacts while normalizing queryable sample units.
- Redact sensitive identifiers in evidence and handoff.

## Verification

- Focused importer test for Junction `respiratory_rate` with `unit: "bpm"`.
- Run the scoped package verification required by the device/importer lane.
- Run typecheck unless blocked by unrelated dirty work.

## State

- Local reproduction confirmed the pre-fix Junction normalizer emitted
  `stream: "respiratory_rate"` with `unit: "bpm"`, matching the core rejection
  path for unsupported respiratory-rate units.
- Fixed Junction timeseries normalization so respiratory-rate aliases
  (`bpm`, `rpm`, slash/spelled variants, and missing unit) become the canonical
  `breaths_per_minute` queryable sample unit while raw Junction artifacts keep
  the upstream payload.
- Added table-driven Junction importer coverage for respiratory-rate unit
  aliases and canonical wearable sample output.
- Confirmed active input latency handling skips device-sync maintenance with the
  focused assistant-runtime test, so this importer failure should not block chat
  typing.
- Verification passed:
  - `pnpm --dir packages/importers test -- device-providers-junction.test.ts -t "respiratory rate unit aliases"`
  - `pnpm --dir packages/importers typecheck`
  - `pnpm --dir packages/importers test:coverage`
  - `pnpm test:smoke`
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-maintenance.test.ts -t "skips device-sync when the caller is handling active input latency"`
- Broader verification was blocked by unrelated pre-existing dirty work:
  - `pnpm typecheck` fails in a dirty assistant-runtime hosted Codex config test
    with missing local test helper names.
  - `bash scripts/workspace-verify.sh test:diff ...` fails in CLI smoke checks
    tied to unrelated built CLI/setup package resolution and CLI config parsing.
- Security/privacy review, coverage-write review, and final task-finish review
  reported no findings.
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
