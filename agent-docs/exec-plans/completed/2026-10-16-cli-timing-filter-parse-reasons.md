# Distinguish knowledge show, wearables day and search query rejection causes in CLI timing

Status: completed
Created: 2026-10-16
Updated: 2026-10-16

## Goal

- Telemetry only: keep the finite, owner-known rejection cause that today is
  lost before the existing CLI timing failure projection, for three unresolved
  clusters. The goal is to tell apart (a) `wearables day` argv rejection vs
  positional date validation, (b) the `knowledge show` parser reason, and
  (c) a `search query` unsupported family vs a comma-delimited filter value.

## Success criteria

- `knowledge show` and `wearables day` admit the existing parser reasons
  `unknown_flag` / `missing_value` for `VALIDATION_ERROR` only.
- `wearables day` admits validation fields `date`, `provider`, `arguments`.
- The shared repeatable-flag normalizer sets a non-enumerable, read-only own
  `cliTimingRejection` (`comma_delimited` / `unsupported_value`) at its two
  existing throw sites. The owner admits it only for `search query` with
  `invalid_option`.
- With timing on or off, real `runMurphCliAction` probes give byte-identical
  stdout/stderr/exits. The target `wearables day`, `search query` and
  `knowledge show` rejections leave the vault byte-identical with zero provider
  calls. The unchanged `list --tag` neighbor reads the vault before its tag
  check, so it may rebuild a derived projection; it makes no canonical write.
  Valid neighbors succeed once each with no canonical writes.
- Old readers drop only the new detail and keep counts. New readers never
  invent detail for old reports.

## Scope

- In scope: `packages/runtime-state/src/cli-timing.ts` owner tables,
  `packages/vault-usecases/src/option-utils.ts` throw sites, focused tests,
  owner doc `docs/hosted-runtime-log-database.md`.
- Out of scope: prompt, schema, command validation, hint/recovery copy,
  normalizer decisions/order, generic shell exit telemetry, `list` command
  ordering, knowledge `not_found`, upsert (already covered).

## Constraints

- Technical constraints: no new stream/state/store/network/await/dependency.
  Reuse own-data-property reads and existing gates. `vault-usecases` does not
  depend on `runtime-state`, so the two literals are repeated at the throw
  site and admitted only by the owner.
- Product/process constraints: model-visible inputs and outputs stay
  byte-identical, so no real-model journey is needed. Tracked files contain
  synthetic data only.

## Risks and mitigations

1. Risk: shared normalizer metadata leaks into other commands' telemetry.
   Mitigation: command+code gate in `rejectionOwners`. Tests cover `list`,
   `event list`, `knowledge show` and `journal link`.
2. Risk: metadata changes the error envelope or serialization.
   Mitigation: non-enumerable defineProperty. Tests compare keys, JSON and
   projection against a bare `VaultCliError`, and compare real CLI bytes with
   timing on and off.

## Tasks

1. Extend owner tables (validation fields, rejection owners, filter classes).
2. Tag the two normalizer throw sites.
3. Runtime-state gate/merge/wire and old-reader tests; bridge tests; real CLI
   and subprocess tests; option-utils descriptor test.
4. Update the owner doc sections and singleton-inspection query.

## Decisions

- Reused the existing parser-reason channel and `cliTimingRejection` property
  convention. No new failure field.
- Skipped stderr-heuristic generic shell telemetry (insufficient evidence).

## Verification

- Package `typecheck` for runtime-state, vault-usecases and cli: pass.
- Vitest: `runtime-state test/cli-timing.test.ts` (with both compat env vars
  below: 53 passed, 12 env-skipped); `cli test/cli-timing.test.ts
  test/incur-error-bridge.test.ts` (21 passed); `cli
  test/cli-timing-subprocess.test.ts` (35 passed); `vault-usecases
  test/option-utils.test.ts` (5 passed).
- Actual old-reader checks:
  `MURPH_CLI_FILTER_REJECTION_COMPAT_BASE=d787a86cdc898a0b8a55a743aaa63e191345d4b6`
  (deployed reader; differs from the task base only by unrelated additive phase
  names) and
  `MURPH_CLI_PARSE_REJECTION_COMPAT_BASE=a83068adbe524217d32a22c270902ef0b02c6921`
  pass. This proves only that new optional detail is dropped and counts are
  preserved. It is not a producer rollout gate.
- Broader vault-usecases experiment files (`experiment-active-lineage`,
  `experiment-plan-source`, `experiment-progress-metric-projection`) first
  failed because the ignored `packages/health-commons/generated/` artifacts were
  absent. After the canonical `pnpm health-commons:generate`, all three files
  pass (56 tests). No source or test change was needed.
- Pending, owned by the parent: independent review, exact-head CI, producer
  rollout ordering, merge/deploy and monitoring. None of these has passed yet.
Completed: 2026-10-16
