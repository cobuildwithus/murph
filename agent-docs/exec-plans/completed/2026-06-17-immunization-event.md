# Immunization Event Surface

## Goal

Give Murph a first-class, structured immunization surface so imported vaccine administrations are stored as queryable event-ledger records instead of clinical notes.

## Success Criteria

- Immunizations have a canonical `immunization` event kind in the shared event ledger.
- The write path uses existing core-owned event/history primitives.
- `vault-cli immunization save/list/show/import-json` is discoverable by the assistant command manifest.
- Focused contract, core/query/usecase, and CLI tests prove the new surface.

## Constraints

- Keep the architecture minimal: no FHIR layer, no vaccine ontology, no new registry, no PDF-specific importer framework.
- Reuse existing event spine fields, `links`, `rawRefs`, and `externalRef` for source/evidence identity.
- This branch may overlap later with the active clinical assertion schema lane; keep changes narrow and easy to rebase.
- Do not include real patient identifiers, signed URLs, local user paths, or source document contents in fixtures, docs, tests, or logs.

## Plan

1. Add the minimal contract/core event shape for `immunization`.
2. Add projected query/usecase/CLI surfaces mirroring existing event-backed health nouns.
3. Add focused tests and regenerate required contract/CLI artifacts.
4. Run required verification and completion audits.
5. Finish with a scoped commit.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
