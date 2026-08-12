# Resolve sparse clinical identity and alert validation findings

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Resolve two validated implementation-review findings without changing the
  sparse clinical storage or admission model.

## Success criteria

- Fetch-side dedupe preserves distinct same-start clinical records by using a
  numeric/string provider row ID when present and bounded importer-compatible
  start/end/value/unit/alert-type fallback identity otherwise.
- Blood-pressure and note dedupe behavior stays unchanged.
- Heart-rate alerts require a nonempty type while accepting any future
  non-exhaustive value.
- Focused tests prove stable-ID and fallback replay behavior, fail-closed alert
  validation, and continued no-sample/no-snapshot retention.
- The existing PR is updated and pushed without launching another ReviewGPT
  run.

## Scope

- In scope: Junction provider dedupe, sparse clinical importer validation,
  focused provider/importer tests, plan closure, scoped commit, PR-body line
  counts, and push.
- Out of scope: resource policy/history, note/blood-pressure semantics, new
  event kinds, storage schema, or a new ReviewGPT pass.

## Constraints

- Technical constraints: preserve the privacy boundary, 100-record import cap,
  and exact provider/source admission fencing.
- Product/process constraints: preserve the existing open PR and changelog,
  use synthetic fixtures only, and do not launch ReviewGPT.

## Risks and mitigations

1. Risk: fetch and importer identity rules drift.
   Mitigation: mirror the importer's ID aliases and normalized fallback fields,
   then assert fetch output and canonical external references independently.
2. Risk: enforcing alert type becomes an accidental closed enum.
   Mitigation: require only a nonempty normalized string and test an unknown
   future value.

## Tasks

1. [x] Validate both review findings against the current provider/importer paths.
2. [x] Patch clinical-only fetch identity and alert-type admission.
3. [x] Add focused provider and importer regression coverage.
4. [x] Run focused tests, typechecks, and diff/privacy review.
5. [x] Close the plan, commit, push, refresh the PR line breakdown, and verify
   the exact pushed head.

## Decisions

- Preserve existing note and blood-pressure branches byte-for-byte; add the
  clinical identity path after them.
- Treat numeric `101` and string `"101"` as the same stable provider identity,
  matching importer `stringId` behavior.

## Verification

- Commands to run:
  - `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/device-providers-junction.test.ts`
  - `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --no-coverage test/junction-provider.test.ts`
  - `pnpm --filter @murphai/importers typecheck`
  - `pnpm --filter @murphai/device-syncd typecheck`
  - `git diff --check`
- Expected outcomes: all focused checks pass; no provider snapshot, raw array,
  provider ID, or canonical sample enters persisted output.
- Results:
  - Importer Junction test: passed, 150 tests.
  - Device-sync Junction provider test: passed, 221 tests.
  - Importer and device-sync TypeScript typechecks: passed.
  - `git diff --check`: passed.
Completed: 2026-08-11
