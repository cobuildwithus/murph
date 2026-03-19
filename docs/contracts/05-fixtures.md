# Fixtures

Status: frozen baseline plus health extension fence

The fixture lane owns the actual corpus under `fixtures/`, but this doc freezes the minimum smoke-contract coverage that corpus must satisfy.

## Required Coverage

- One minimal vault scaffold with stable locations for `CORE.md`, journal pages, experiment pages, and the raw/ledger/audit/export directories referenced by smoke scenarios.
- Sample-import inputs for document import, meal add, and CSV sample import flows. Workout capture does not require a separate file fixture because it records one freeform text argument directly.
- Assessment-import inputs with stable `raw/assessments/YYYY/MM/<assessmentId>/source.json` locations and matching `ledger/assessments/YYYY/YYYY-MM.jsonl` shards.
- Profile snapshot fixtures that rebuild a deterministic `bank/profile/current.md`.
- One Markdown fixture each for goals, conditions, allergies, regimens, family members, and genetic variants.
- One golden-output directory per documented baseline command.
- Smoke expectations that describe:
  - document and meal writes returning `lookupId` plus stable related ids
  - workout quick capture returning one queryable `evt_*` id for an `activity_session` event while preserving the freeform note text and any explicit structured strength exercise details
  - sample imports returning `lookupIds` plus an `xfm_*` batch id
  - intake import returning an `asmt_*` id and intake project returning deterministic proposal payloads
  - profile snapshot append plus `profile current rebuild`
  - noun flows for `scaffold`, `upsert --input`, `show`, `list`, and `regimen stop`
  - history writes for `encounter`, `procedure`, `test`, `adverse_effect`, and `exposure`
  - experiment creation idempotence via `created: false`
  - validation issue accumulation for malformed markdown frontmatter
  - show/list lookup rules for queryable vs non-queryable related ids
  - export packs materializing `manifest.json`, `question-pack.json`, `records.json`, `daily-samples.json`, and `assistant-context.md`

## Determinism Rules

- Reuse the frozen schema versions and error codes from `packages/contracts/src/constants.ts`.
- Reuse the frozen ID policy from `docs/contracts/02-record-schemas.md`.
- Keep timestamps within the March 2026 baseline so shard paths stay deterministic.
- Keep all stored paths relative and vault-local.
- Keep health noun fixtures deterministic by pinning ids to the frozen `asmt`, `psnap`, `goal`, `cond`, `alg`, `reg`, `fam`, and `var` prefixes.
- Treat `xfm_*` values as import-batch identifiers only; do not require standalone transform records in the fixture corpus.

## Reference Set

`packages/contracts/src/examples.ts` is the contract reference set for canonical payload examples. Package tests remain the executable truth for full contract-shaped markdown and JSONL data.
