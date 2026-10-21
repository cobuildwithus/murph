# Preserve assessment classification and source links through the CLI

Status: completed
Created: 2026-09-29
Updated: 2026-09-29

## Goal

- Let the intake CLI pass through existing assessment classification and canonical source links so structured clinical recovery can preserve historical meaning and provenance.

## Success criteria

- New CLI options survive importer, canonical ledger, query readback, and raw manifest; invalid metadata rejects before writes. Existing unclassified imports remain compatible.
- Direct recovery proof has source audits, duplicate/replay checks, unchanged baseline records and raw evidence, and successful query readback.

## Scope

- In scope: optional intake metadata, focused synthetic tests, and direct local recovery proof using canonical CLI owners. Further vault-only document recovery and export packaging continue separately without repository artifacts.
- Out of scope: production vault mutation, deployment, interpreting old orders as ingestion or old diagnoses as current conditions.

## Constraints

- Reuse assessment storage and typed immunization storage. No new canonical schema or mutation owner.
- Keep private records and reports outside tracked artifacts. Model verification uses subscription authentication only.

## Risks and mitigations

1. Historical provider statements could be mistaken for current confirmed facts. Preserve source record type, original workflow status, and dates in structured responses; do not mutate current regimen or condition registries.
2. Import retries could duplicate assessment records. The private recovery runner checks persisted source keys before each import and verifies a no-write replay.

## Tasks

1. Audit source-note values and remaining report findings on an isolated export.
2. Pass assessment type, questionnaire slug, and related ids through the CLI and importer.
3. Verify synthetic CLI writes/readback and typechecks; source-audit private proposals before importing.
4. Verify source preservation, query retrieval and replay for the metadata implementation.

## Decisions

- Existing assessment response JSON preserves coded answers and original unit-less quantities without converting them into normalized vital signs.
- Product UX: import categorized answers with source links; retrieve via intake show and search; retain default intake behavior when flags are absent. No hosted UI changes.
- Product UX result: Ready. Private source history remains categorized assessment data and does not mutate current medication or condition registries. Importing assessment JSON remains append-only; callers needing recovery replay must deduplicate before import.

## Verification

- Passed: importer input-validation tests (6), CLI intake/export plus generated configuration tests (8), importer/CLI/vault-usecase typechecks, and generated CLI artifacts.
- Passed: changelog generation and archive render tests (10), Web typecheck, complexity guard, docs drift, and whitespace checks. The first prepared Web check lacked a generated Prisma client; the complete typecheck command generated it and passed.
- Direct private proof passed source review, exact canonical response readback, CLI reads, immutable baseline records/files, and a no-write replay. Private evidence remains excluded from repository artifacts.
- Existing clinical raw-manifest validation defects remain; new source links repeat existing validator diagnostics. They do not indicate changed source bytes. Missing original raw references and unresolved prior operations are unchanged.
- Final PR review and exact-head CI follow the repository completion workflow; no merge or production deployment is authorized by this plan.
Completed: 2026-09-29
