# Clinical Journal dates and readable records

Status: completed
Created: 2026-09-18
Updated: 2026-09-18

## Goal

- Show imported clinical events on their documented dates, with readable summaries and one Journal entry per linked source event. Preserve original source records and evidence.

## Success criteria

- New extraction uses explicit document date evidence or an attested source date; unsupported retrieval-day dates are held.
- Undated administrative records never masquerade as today's visits. Long records, JSON, and machine source keys do not overwhelm native Journal.
- Synthetic regression tests, relevant typechecks, native build/tests, and private export replay support the result.

## Scope

- In scope: canonical enrichment date admission, shared Journal projection for existing imports, native presentation, owner documentation and focused proof.
- Out of scope: deleting source evidence, medical interpretation, production data mutation and deployment.

## Constraints

- Canonical records remain authoritative. Journal corrections derive from exact source identity, never similar titles. Read all source parents before the date-window filter; preserve distinct documented dates within a longitudinal document.
- Keep private exports and screenshots out of repository artifacts. No new data store or dependency is needed.

## Risks and mitigations

1. A document can describe more than one event date. Require explicit date provenance for new extraction. Omit ambiguous legacy import-day facets from dated bands while preserving their original source report.
2. Old clients consume the same Journal shape. Keep the response shape compatible; unknown-date administrative records remain in the vault rather than entering dated Journal bands.

## Tasks

1. Trace private evidence using content-free aggregates and reproduce with synthetic source records.
2. Fix date admission and the shared projection, including source grouping and clinical presentation.
3. Bound native previews and retain readable full details.
4. Run focused proof, review the diff, update owners and changelog, and commit scoped changes.

## Decisions

- Product UX effort: patch. Outcome: trustworthy dates and scannable clinical entries. Reaches: new and existing imports, unknown clinical dates, multi-date documents, native feed/detail, ordinary non-clinical notes. Proof: faithful synthetic projection/enrichment tests, private export replay, and native rendered evidence.
- Existing source parents retain historical timestamps, while some extracted facets carry retrieval-day midnight. The shared projection omits ambiguous derived dates while preserving the historically dated source and all canonical evidence.

## Verification

- Focused query and clinical enrichment tests; query and vault-usecases typechecks; native Journal tests and simulator build; complexity and privacy diff review.
- Private replay reports only counts and pass/fail facts, never record contents or identifiers.

## Result and review

- Implemented explicit document/source date provenance, attested parent clinical dates, and a date-context-bound extraction cache. Unsupported dates remain held; legacy ambiguous import-day facets stay out of dated Journal bands without canonical mutation.
- Implemented exact-source/day note and result grouping, readable clinical labels, and date-only timing. Native rows show three summary lines; long secondary sources expand in details.
- Review found that date coincidence could not justify changing a clinical date, and that cached extraction depended on parent date context. Both findings are resolved with deterministic regressions. Parent date selection follows the importer contract.
- Product UX verdict: Ready for the tested local candidate. Existing undated administrative records, historical source reports, explicit same-day follow-ups, multi-date documents, source-cache changes, and ordinary Journal notes are covered. Deployment and live vault mutation remain outside this task.

## Completed verification

- Query focused Journal proof: 37 tests pass. The broader query suite also passed (875 tests, one skipped).
- Vault use cases: enrichment, parent attestation/date priority, laboratory publication, and cache-context regressions pass (57 tests across the final focused runs).
- Clinical-records schema package: 57 tests pass. Assistant extraction boundary: eight tests pass.
- Assistant runtime clinical enrichment and import-to-query flow: 32 tests pass across the focused runs, preserving mailbox ordering, replay, withdrawal, and canonical lab publication.
- Typechecks pass for query, vault-usecases, clinical-records, assistant-engine, assistant-runtime, and hosted Web. Complexity passes with six changed source files and no functions above 20. Authored privacy scan and diff whitespace checks pass.
- Changelog generation and focused page tests pass (10 tests).
- Native simulator build, seven Journal unit tests, and the compact-preview/source-disclosure UI test pass. Synthetic screenshots were inspected. Changed-file SwiftFormat lint passes. Native commit: `d373063`.
- Private read-only export replay passes: ambiguous import-day clinical entries and raw FHIR/source identifiers are absent from the clinical display. Original exported records remain intact.
- Live proof: `pnpm test:assistant:live -- --test "clinical extraction live preserves historical dates and blocks undated visits"`, model `gpt-5.6-terra`, local subscription. One successful provider call preserved two explicit dates and held the undated visit; no writes. Verdict: Ready. Initial local homes failed authentication or quota before provider work; the documented alternate-home retry succeeded.

## Verification limitations

- No deployment, production mutation, pushed PR, exact-head CI, or external ReviewGPT was performed. Those remain rollout gates.
- Initial script argument forwarding accidentally selected broad package suites. The broad vault suite encountered missing generated Health Commons assets; the broad engine suite was interrupted through its owned session after an unrelated CLI fixture failure. Required focused tests and typechecks passed after preparing generated inputs.
- `swiftformat --lint .` traversed pre-existing vendored build caches and failed; linting all six changed Swift files passed. No vendor files were changed.
Completed: 2026-09-18
