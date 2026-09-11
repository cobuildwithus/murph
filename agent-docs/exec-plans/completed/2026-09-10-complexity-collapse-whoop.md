# Simplify WHOOP snapshot normalization

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Reduce repeated branching and projections in the WHOOP snapshot normalizer while preserving every emitted event, timestamp, identity, and evidence association.

## Success criteria

- Lower function and file cyclomatic complexity through deletion of repeated decisions.
- Preserve provider/vault day precedence, legacy aliases, body account scope, fallback IDs, event order, and numeric omission semantics.
- Pass focused provider regressions, importer typecheck, and the complexity guard.

## Scope

- WHOOP normalization source, focused provider tests, and this execution record.
- No provider API, schema, canonical storage, credential, scheduling, prompt, or product behavior changes.

## Architecture and evidence

The importer owns pure provider snapshot normalization and delegates writes to core. The current body-measurement block repeatedly guards one optional object even though its inner date helpers repeat the same guard. Workout metrics repeat seven finite-number assignment branches. Sleep, cycle, and workout records repeat identical interval timestamp parsing. Consolidate those existing projections within the WHOOP owner and reuse existing omission helpers. No persisted state or public abstraction is added.

## Risks and mitigations

- Body day and legacy identity precedence affects replay: retain the exact candidate order and run canonical replay, user-edit, tombstone, and account-scope regressions.
- Missing, invalid, and zero-valued data must remain distinct: test absent bodies and metric omission alongside zero values.
- Sleep/cycle/workout occurrence and day rules differ: share only identical timestamp parsing and keep each record family's policy explicit.
- The change preserves output schemas and has no deploy sequencing or mixed-version requirement.

## Tasks

1. Consolidate body projection behind one absence guard, use existing metric omission primitives, and deduplicate interval timestamp parsing.
2. Add focused omission regressions and run existing provider-shaped normalization and replay proof.
3. Inspect the complete diff, privacy, and complexity results; close the plan with a scoped neutral-authored commit and open a draft PR for parent review.

## Product UX and changelog

Internal behavior-preserving refactor. No member-facing flow or meaning changes; no changelog entry is needed.

## Verification

- Passed: `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/device-providers.test.ts test/device-provider-snapshot-validation.test.ts test/device-providers/deletion-normalization.test.ts` — 92 tests across three files, including canonical replay, provider-day precedence, body legacy identities, and deletion behavior.
- Passed: `pnpm --dir packages/importers typecheck`.
- Passed: `pnpm complexity:diff --base HEAD --json -- packages/importers/src/device-providers/whoop.ts` against the pre-change checkout. Maximum/normalizer complexity 93 to 69, debt 73 to 49, total complexity 235 to 213; body projection 17, workout metric builder 13 to 6.
- Source changed by +82/-131 lines (net -49). The remaining normalizer hotspot keeps distinct sleep/recovery/cycle/workout rules explicit; further extraction alone would relocate its decisions.
- Full source/test diff and privacy review passed; `git diff --check` passed. Existing Frog entries were inspected; no new repository friction was encountered.
- The scoped implementation is complete. Parent owns candidate review, exact-head CI, final ReviewGPT, and Ready admission; these remain pending at draft handoff.
Completed: 2026-09-10
