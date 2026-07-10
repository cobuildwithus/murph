# Clinical Records

`@murphai/clinical-records` owns pure contracts and helpers for Clinical
Records Intake. It does not own OAuth, tokens, web routes, Prisma tables,
assistant behavior, raw-file writes, or canonical vault mutation.

The package boundary is intentionally small:

- source-system and FHIR resource constants
- clinical raw FHIR retrieval manifest contracts
- deterministic FHIR external-reference helpers namespaced by FHIR base and patient hashes
- clinical `upsert | retract | review` import-plan decision contracts

FHIR/MyChart data remains raw evidence. Canonical Murph records stay in the
vault and must be written through the existing core/import surfaces.

## Raw retrieval contract

Retrieval producers must use `hashClinicalFhirBaseUrl` and
`hashClinicalFhirPatientId` for the manifest namespace and
`hashClinicalFhirPageUrl` for captured pagination URLs. Relative patient
references use exact `Patient/<id>` grammar; absolute references must resolve
to the manifest FHIR base hash. Before issuing a pagination request or
forwarding authorization, producers must reject next links outside that same
HTTP(S) base, including credential-bearing and sibling-prefix URLs.
Each raw file contains only its declared resource family, and every resource
must bind to the manifest patient. `completedResourceTypes` records only
families whose pagination finished without a matching manifest error; even an
empty completed family has a declared zero-count raw file.

The clinical importer reads each raw page once, then validates its hash, count,
resource family, patient binding, and pagination links before mapping any
decision. Pagination links must remain under the manifest FHIR base, resolve
within the declared resource family, form an acyclic chain, and reach every
declared continuation page from a root page. A no-known-allergies upsert
additionally requires completed, error-free `AllergyIntolerance` and
`Condition` retrieval with granted read scope for both families.

## Decision identity, provenance, and freshness

Each FHIR resource emits exactly one `upsert`, `retract`, or `review` decision.
Upserts and retractions share one facet-free external identity regardless of
whether the current resource maps as a scalar, panel, or another supported
shape. Every decision carries its raw evidence, while retrieval metadata stays
on the plan. A strict `meta.lastUpdated` is required as the exact
`externalRef.version`.

Core bulk event import skips older revisions and source-semantically equal
same-version replays even when retrieval paths differ. It rejects true
same-version conflicts, supersedes newer same-kind upserts, tombstones and
replaces a live event when a newer revision changes kind, and tombstones the
live event for a newer authoritative retraction. Versioned decisions for one
source identity are applied in source-revision order within a batch. When a
retraction arrives before any live fact, core writes an invisible deleted source
marker into the existing event ledger; older or equal revisions cannot later
resurrect it, while a newer upsert can become live. Review decisions preserve
raw evidence without mutating canonical records.
