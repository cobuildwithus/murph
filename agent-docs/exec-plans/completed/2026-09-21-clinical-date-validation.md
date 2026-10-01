# Validate fresh clinical extraction dates

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Goal

- Prevent fresh clinical extractions from assigning unsupported dates while preserving useful, dated records and quiet partial imports.

## Success criteria

- Missing provenance and contradictory date evidence cannot publish a clinical fact.
- Historical, same-day, source-dated, timezone-normalized and mixed-validity pages retain their supported records.
- Focused deterministic proof, relevant typechecks and one production-derived real-model journey pass.

## Scope

- In scope: existing extraction schema, canonical date admission, focused tests and owner documentation.
- Out of scope: old vault repair, new UI, new confirmation steps, provider calls or dependencies.

## Constraints

- Keep existing raw evidence, record identities, short canonical writes and bounded per-page holds.
- Preserve old persisted proposal readability; unsupported queued facts may be held without rewriting canonical history.

## Risks and mitigations

1. Legitimate document dates use several formats and timezones. Cover common full-date forms and equivalent timestamps; retain the attested source-date path.
2. One invalid proposal must not discard valid sibling records. Validate each fact at the existing canonical admission seam.

## Tasks

1. Add failing synthetic cases for absent provenance, delayed extraction and contradictory evidence.
2. Remove unsupported-date fallback; validate document-date consistency and require fresh provider provenance.
3. Verify valid records, replay and partial-page behavior; run focused real extraction and typechecks.
4. Review privacy, complexity, UX and diff; update owners and commit scoped changes.

## Decisions

- Outcome: dated health facts reflect supported source dates.
- Reaches: fresh imports, delayed extraction, documents with independent event dates, partial pages and queued older proposals.
- Proof: canonical query readback plus real-model extraction; no additional member interaction.

## Verification

- Focused clinical-records, enrichment, extraction and runtime tests; affected package typechecks.
- Real-Codex historical-date journey through the production extraction contract.

## Result

- Removed the missing-provenance date fallback. Unsupported facts are held individually before canonical lookup or mutation.
- Added one bounded date-consistency helper, reused the existing date/time contracts, and kept source-date resolution unchanged.
- Fresh provider schemas require a non-null basis. Cache v3 avoids reusing proposals made under the older date policy; persisted schemas remain readable.
- No new dependency, state owner, UI, confirmation, provider call or old-vault repair.
- Product UX: Ready. Historical and same-day events, common complete date forms, timezone normalization, source-only reports, partial pages, deduplication and checkpoint replay retain their supported outcomes.

## Completed local verification

- The two synthetic bug regressions failed on the baseline and pass after the change.
- 133 focused deterministic tests pass across enrichment/date/parent/labs, clinical schemas, assistant extraction, hosted runtime import flow and changelog rendering.
- Typechecks pass for clinical-records, vault-usecases, assistant-engine and hosted Web.
- Complexity: four changed source files, no functions above 20, guard passes. Privacy and whitespace checks pass.
- Live command: `pnpm test:assistant:live -- --test "clinical extraction live preserves supported dates across import-day context"`.
- Live proof: model `gpt-5.6-terra`, local subscription, one successful provider call. Three supported historical/same-day facts remain; one undated secondary event is blocked; no canonical or source writes. Output reviewed: Ready.
- Initial subscription homes failed authentication or quota before inference; the authorized alternate-home procedure produced the successful run.
- Reused the existing documented-changelog-command Frog entry; ran the prepared Web test from the repository root. No new friction entry.

## Delivery

- Implementation and local verification are complete. PR review, exact-head CI and deployment remain separate gates tracked on the PR.
Completed: 2026-09-21
