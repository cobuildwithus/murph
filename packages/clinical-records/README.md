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
candidate. Pagination links must remain under the manifest FHIR base, resolve
within the declared resource family, form an acyclic chain, and reach every
declared continuation page from a root page. A no-known-allergies candidate
additionally requires completed, error-free `AllergyIntolerance` and
`Condition` retrieval with granted read scope for both families.

## Candidate identity and freshness

One FHIR resource maps to one external identity regardless of whether its
current content maps as a scalar, panel, or another supported shape. Mapping
facets remain provenance only. Supported candidates require a strict
`meta.lastUpdated`, stored as `externalRef.version`; core bulk event import
skips an older ISO source revision, rejects conflicting content at the same
source revision, and supersedes only with a newer revision. Raw evidence refs
remain attached to every candidate.
