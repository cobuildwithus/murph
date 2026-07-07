# Clinical Records

`@murphai/clinical-records` owns pure contracts and helpers for Clinical
Records Intake. It does not own OAuth, tokens, web routes, Prisma tables,
assistant behavior, raw-file writes, or canonical vault mutation.

The package boundary is intentionally small:

- source-system and FHIR resource constants
- clinical raw FHIR retrieval manifest contracts
- deterministic FHIR external-reference helpers namespaced by FHIR base and patient hashes
- clinical import-plan and Tier 1 candidate contracts

FHIR/MyChart data remains raw evidence. Canonical Murph records stay in the
vault and must be written through the existing core/import surfaces.
