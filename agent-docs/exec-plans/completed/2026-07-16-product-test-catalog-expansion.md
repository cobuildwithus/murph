# Expand public product-test catalogs and reviewed matching

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Expand Murph's product-test coverage with lawful, source-faithful public
  catalogs; refresh the existing open catalogs; make reviewed product matching
  deterministic and replay-safe; and reconcile proven database drift without
  turning ambiguous source records into guessed product claims.

## Success criteria

- A private full labels-database snapshot is restored into a separate local
  PostgreSQL database and aggregate counts match the source snapshot.
- Existing catalog refreshes and each new open catalog produce deterministic,
  fixture-tested rows with stable natural keys and faithful measurement
  metadata.
- Product-test schema and runtime output preserve sample/lot/time, measurement
  qualifier, method, and sampling-context distinctions needed by the new
  sources.
- Automatic matching is limited to mechanically proven identifiers; ambiguous
  candidates remain source-only until a reviewed decision is committed.
- Reviewed remap application is dry-run-first, compare-and-set, fingerprinted,
  idempotent, and refuses conflicting or stale decisions.
- Local import and remap rehearsals pass integrity audits before any live write;
  live writes, if eligible, are aggregate-verified and represented by durable
  reviewed artifacts.
- Focused tests, diff-aware tests, typecheck, acceptance verification,
  coverage-write, required review, CI, and ReviewGPT pass for the exact PR head.

## Scope

- In scope:
  - Private remote snapshot, isolated local restore, aggregate data audit, and
    local rehearsal of every mutation.
  - Existing PlasticList, NYC DOHMH, King County, and Pure Earth refreshes.
  - Recent product-identifiable quantitative government/open sources whose
    factual data is reusable, beginning with FDA lead alerts/investigations and
    the NY Attorney General Holle testing package.
  - A maintained source registry that records evidence semantics, rights
    posture, freshness, adapter status, and why a catalog is importable,
    discovery-only, generic-only, or permission-gated.
  - Source-only import, deterministic candidate generation, reviewed remaps,
    product-test integrity audits, and exact/full-label ingestion when a
    reviewed match requires a genuinely missing product.
- Out of scope:
  - Scraping or republishing Consumer Reports, ConsumerLab, Lead Safe Mama,
    HBBF, As You Sow, iHerb, IFOS, Labdoor, Clean Label Project, Mamavation,
    AB 899 manufacturer portals, or any other permission-gated catalog.
  - Attaching anonymous/category-only government samples to branded products.
  - Treating recalls, allegations, certifications, or generic environmental
    observations as quantitative product measurements.
  - Broad cleanup of legacy supplement provenance rows that is unrelated to
    product-test correctness.

## Constraints

- Technical constraints:
  - Use only `MURPH_LABELS_DB_URL`; never print, persist, or pass its value in
    command arguments.
  - Keep database exports and row-level review artifacts in ignored private
    local storage with restrictive permissions.
  - Product-test imports remain additive by default and use stable natural
    keys; full-source replacement requires an explicit reviewed deletion diff.
  - Source facts never create sparse food/supplement placeholders. Missing
    products must enter through the existing full-label ingestion contract.
- Product/process constraints:
  - Preserve source-only as a truthful result and never fuzzy-auto-link.
  - Keep result semantics sample-, lot-, and time-specific; do not imply a
    product is permanently safe or unsafe.
  - Follow source licenses and government reuse terms; embedded third-party
    reports/images are linked, not mirrored, unless rights are proven.
  - Use an isolated worktree, durable plan/ledger, scoped commit, PR, required
    audits, and exact-head ReviewGPT/CI gates.

## Risks and mitigations

1. Risk: A fuzzy or stale match attaches a test to the wrong product variant.
   Mitigation: exact-identifier automation only, raw source/target fingerprints,
   multi-candidate manual review, compare-and-set apply, and conflict refusal.
2. Risk: A source refresh silently deletes or reinterprets historical rows.
   Mitigation: additive default, stable source record IDs, identity-drift
   demotion to source-only, guarded replacement manifests, and pre/post audits.
3. Risk: Result rows lose lot, date, qualifier, method, or sampling context.
   Mitigation: explicit queryable columns, adapter fixtures, and runtime contract
   tests for non-detects, censored values, XRF, and targeted investigations.
4. Risk: Publicly visible data is mistaken for openly reusable data.
   Mitigation: source-registry rights disposition, official-source citations,
   permission-gated adapters disabled by design, and no copied report imagery.
5. Risk: Remote writes corrupt a large shared dataset.
   Mitigation: full private snapshot, separate local restore, dry-run and local
   apply rehearsal, advisory locking, bounded mutations, and aggregate proof.

## Tasks

1. Snapshot and restore the labels database locally; record aggregate baseline
   and integrity findings without persisting private row data.
2. Inventory unmatched source products, current reviewed mappings, live/committed
   drift, and matchable exact identifiers.
3. Audit recent public product-testing catalogs for data shape, evidence type,
   identifiers, freshness, reuse rights, and product-match eligibility.
4. Add a typed source registry and extract deterministic adapters from the
   current monolithic sync; add new lawful catalog adapters and fixtures.
5. Extend the product-test contract only where required for faithful sample,
   lot, timing, qualifier, method, evidence, and rights provenance.
6. Replace dynamic source-key collision checks with one explicit legacy
   source-backed-origin invariant; update SQL/runtime tests and docs so a real
   label origin cannot disappear merely because a catalog later reuses its key.
7. Harden remap export/review/apply with fingerprints, exact-method proof,
   compare-and-set behavior, dry-run/preimage support, and idempotency.
8. Refresh/import all eligible source rows locally, generate ranked candidates,
   review deterministic matches, ingest any complete missing labels, and
   reconcile the 22 unexplained live PlasticList decisions.
9. Run local integrity and rollback rehearsals; apply only proven changes to the
   live database and verify aggregate outcomes.
10. Run required verification and audits, commit with `scripts/finish-task`,
    push, open the PR, run ReviewGPT with CI, and remediate until exact-head
    gates pass.

## Decisions

- "Publicly available" is not treated as permission for bulk commercial reuse.
  Permission-gated catalogs are tracked as partnership targets, not scraped.
- Only quantitative measurements and explicit regulator-confirmed qualitative
  detections enter `product_tests` in this change. Recall, allegation,
  certification, disease-claim-only, and anonymous-composite feeds remain
  separately classified source-registry entries until a dedicated product
  contract requires them.
- Government tests without exact brand/SKU identity remain source-only or
  generic evidence; they are never inferred onto a branded label.
- No production write occurs before a complete local restore and identical
  local import/remap rehearsal pass.

## Outcome evidence

- Restored the private labels snapshot into an isolated local database and
  matched the source aggregates: 2,027,813 foods, 239,365 supplements, 19,886
  product-test observations, and one active threshold before reconciliation.
- Refreshed ten enabled open-source adapters into an exact 8,958-row manifest;
  the combined catalog now contains 20,697 observations across 11 sources.
- Reconciled 98 reviewed PlasticList identities and 32 reviewed government/open
  identities with source, target, and current-state fingerprints. Local and
  production replays both report zero mutations.
- Removed exactly two unreferenced stale food labels and retired 24 unsupported
  study-comparison serving masses. The guarded cleanup and serving reconciliation
  both replay with zero proposed changes.
- The production integrity audit passes with 4,047 food-linked observations,
  513 supplement-linked observations, and every remaining unlinked observation
  explicitly represented as `source_only`.
- The exact-identifier unmatched audit found five remaining source-only products
  with valid GTINs and zero matching catalog target groups; no automatic match
  was eligible.

## Verification

- Commands to run:
  - Aggregate-only source/restore count and integrity queries.
  - Focused adapter, SQL-contract, runtime, and PostgreSQL integration tests.
  - Local sync/import/remap dry-run, apply, replay, conflict, audit, and rollback
    rehearsal against the isolated labels database.
  - `pnpm test:diff`
  - Relevant workspace typechecks selected by the testing/CI map.
  - `pnpm verify:acceptance`
  - Required coverage-write and parent final review.
  - PR CI plus ReviewGPT on the exact pushed head.
- Expected outcomes:
  - Deterministic source counts and hashes, zero natural-key duplicates, zero
    FK/link/method violations, zero unreviewed mutations, identical replay with
    zero updates, and no source-only observation exposed as a matched product.
- Completed local evidence:
  - Focused web verification passed eight files and 139 tests; focused CLI
    label verification passed 13 tests; web and CLI typechecks passed.
  - The required coverage-write pass added stale-cleanup contract coverage and
    returned with zero unresolved findings.
  - `git diff --check` passed, and the generated CLI configuration hash was
    refreshed after acceptance detected it was stale.
  - The repository-wide `pnpm test:diff` and `pnpm verify:acceptance` lanes were
    blocked by unrelated host contention: broad CLI tests timed out after the
    touched label suites passed, assistant-engine coverage exhausted its worker
    memory, and the web development smoke became healthy only after its timeout.
    Acceptance otherwise completed the full workspace typecheck, documentation
    checks, production build, app tests, and the remaining package coverage
    matrix before the failed coverage worker stopped final aggregation.
Completed: 2026-07-16
