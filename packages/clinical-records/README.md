# Clinical Records

`@murphai/clinical-records` owns pure contracts and helpers for Clinical
Records Intake. It does not own OAuth, tokens, web routes, Prisma tables,
assistant behavior, raw-file writes, or canonical vault mutation.

The package boundary is intentionally small:

- source-system and FHIR resource constants
- clinical raw FHIR retrieval manifest and bounded attachment-batch contracts
- deterministic FHIR external-reference helpers namespaced by FHIR base and patient hashes
- clinical `upsert | retract | review` import-plan decision contracts
- bounded document-extraction proposal schemas for labs, measurements and history

FHIR/MyChart data remains raw evidence. Canonical Murph records stay in the
vault and must be written through the existing core/import surfaces.

DocumentReference and DiagnosticReport attachments are preserved as separate
immutable evidence. Inline bytes are validated directly; linked Binary bodies
use a Web-issued, run-bound ticket. DiagnosticReport study images may use the
single patient-bound Media-to-Binary hop documented by the Epic adapter. Text
and clinical XML can become source notes, while PDFs use the existing Poppler
parser. Original images remain raw evidence. Separate document enrichment can
extract facts from text and rendered PDF/image pages. An unresolved
attachment produces explicit incomplete coverage and never a partial same-
revision canonical note.

Large charts are imported one page batch at a time. A successor batch must prove
the previous immutable manifest and outgoing FHIR link, so a middle page cannot
be injected as a new root. Batch checkpoints retain accepted bytes, pending
document tickets, cursors, and cumulative outcomes across preemption.

## Document enrichment contracts

Each imported batch with downloaded documents admits enrichment for its own
manifest before the retrieval checkpoint advances. The runtime extracts one
document page at a time with up to three read-only family leaves and a shared
120-second provider timeout. The pure schemas bound each family's proposals;
model output cannot choose canonical identities or source paths.

Vault use cases freeze proposals in private operational state. A separate
bounded canonical apply derives source identity and raw/page evidence, checks
existing facts, and reads back accepted writes before progress. Replay reuses
the frozen proposals. Unsupported or missing documents before extraction and
ambiguous facts remain explicit holds while later documents can progress.
Invalid manifests or changed prepared source bytes fail closed.
These contracts do not assert that every fact in a document was recovered.

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

`murph.clinical-raw-manifest.v2` requires exactly one `retrievalScopes` entry
per requested resource family. A `whole-family` scope proves a complete family;
a `bounded-window` scope records its exact `from` and `to` bounds and must never
be interpreted as global absence evidence. Every scoped family must have raw
page evidence or a typed terminal error. The first page of a pagination chain
has no `pageUrlHash`; each continuation page carries the hash targeted by the
preceding page's `next` link and `nextPageUrlHash`. Raw Bundle navigation links
remain immutable evidence, while hashes give the manifest a URL-free chain
identity.

Raw page limits are part of the retrieval contract: at most 1,000 resources may
appear in one page. Runtime producers import each validated page as its own
batch, so a chart may continue beyond the former 5,000-resource aggregate
snapshot limit without discarding earlier batches. Per-page bytes, attachment
bytes and descriptor counts remain bounded; a bound yields explicit incomplete
coverage for the affected batch.

The clinical importer reads each raw page once, then validates its hash, count,
resource family, patient binding, and pagination links before mapping any
decision. Pagination links must remain under the manifest FHIR base, resolve
within the declared resource family, form an acyclic chain, and reach every
declared continuation page from a root page. A no-known-allergies snapshot
decision additionally requires completed, error-free `AllergyIntolerance` and
`Condition` retrieval with granted read scope for both families. Its manifest
`fetchedAt` is the ordered revision for that patient-and-FHIR-base aggregate;
retrieval producers must assign later complete snapshots a later timestamp.

## Decision identity, provenance, and freshness

Each FHIR resource emits exactly one `upsert`, `retract`, or `review` decision.
A complete allergy evidence family may additionally emit one aggregate
no-known-allergies decision, keyed to one patient snapshot identity rather
than an individual FHIR resource. Upserts and retractions share one facet-free
external identity regardless of whether the current resource maps as a scalar,
panel, or another supported shape. Every decision carries its raw evidence,
while retrieval metadata stays on the plan. A strict `meta.lastUpdated` is
required as the exact resource-local `externalRef.version`; the aggregate
allergy identity uses manifest `fetchedAt`.

Core bulk event import skips older revisions and source-semantically equal
same-version replays even when retrieval paths differ. It rejects true
same-version conflicts, supersedes newer same-kind upserts, tombstones and
replaces a live event when a newer revision changes kind, and tombstones the
live event for a newer authoritative retraction. Versioned decisions for one
source identity are applied in source-revision order within a batch. When a
retraction arrives before any live fact, core writes an invisible deleted source
marker into the existing event ledger; older or equal revisions cannot later
resurrect it, while a newer upsert can become live. At the explicit clinical
execution seam, a comparable review for a resource family that could have
previously produced a canonical event becomes the same retraction marker, so
delayed older revisions remain held. A supported resource with an id but no
comparable source revision fails closed instead of silently discarding that
ordering information. Other review decisions remain plan-only raw evidence.
