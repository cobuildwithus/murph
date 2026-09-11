# Clinical Records Intake

Last verified: 2026-09-11

## Product outcome

Murph can send a member a short records-connect link, let them find a likely
Epic organization by provider, facility, city, state, or postal text, complete
the provider's own SMART-on-FHIR sign-in, and import the authorized record
families into the member's encrypted vault. The common path asks for no portal
password inside Murph and no manual file download.

The Epic policy collects 40 queries across 17 resource families, including
labs, reports, medications, allergies and other chart records. Supported facts
become canonical records; other evidence remains raw. This is a bounded
one-time import, not a complete medical record or continuous sync.

This first release is an Epic SMART foundation, not a TEFCA/QHIN replacement.
It does not claim nationwide identity matching, discover every organization a
person has visited, connect email, or retrieve records from a provider that
does not expose a compatible patient-facing SMART endpoint.

### Standard clinical measurements

The FHIR importer maps standard LOINC height, BMI, head circumference, oxygen
saturation, weight, temperature, blood pressure and rate measurements into the
canonical measurement surface. It preserves source values and accepted units
(including inches, grams and Fahrenheit) and source revision/evidence identity.
Equivalent oxygen-saturation codings in one observation produce one measurement.
Incompatible units, ambiguous values and missing comparable revisions retain
their existing explicit review/retraction behavior. These mappings do not
change acquisition scope; new retrieval plans independently request lifetime history.

### Hospital history and source notes

Supported allergies, conditions, medication requests/statements/dispenses,
encounters, procedures, immunizations, family history, care plans/teams, goals,
devices and service requests become dated, source-versioned notes. The notes
retain readable labels, source statuses and selected structured clinical details
with raw evidence links. Rendered object keys use deterministic recursive ordering;
array order and field values remain meaningful for source-revision conflicts.
These notes do not overwrite member-confirmed registries,
activate provider goals or treat prescriptions/dispenses as doses taken.
When an exact clinical date is unavailable, the note explicitly identifies its
source-update date rather than presenting it as the clinical event date.

Inline clinical note text beyond 4,000 characters uses existing ordered note
sections (up to 50 sections of 12,000 characters) with Unicode-safe boundaries.
Oversized or invalid evidence remains explicitly held. Provider withdrawals
and conflicting revisions retain the existing revision checks.
Linked Binary acquisition and document enrichment have separate owners from
these deterministic retained-snapshot mappings.

## Member flow

1. The assistant or signed-in dashboard creates a 15-minute, single-use,
   member-bound connect intent. Generic intents carry no provider choice. The
   browser claim starts in the URL fragment so it is not sent in referrers or
   routine server request logs, then moves into the current history entry so a
   sign-in or pre-authorization reload can resume after the visible fragment is
   scrubbed. It is removed before navigation to Epic. At most one incomplete intent may exist per
   member; creating a new intent supersedes any prior uncompleted flow.
2. The connect page verifies the current Murph app session and health-data
   consent, then searches Murph's server-owned Epic directory. A provider may
   be suggested from member-entered city/state text, but the member chooses the
   organization before authorization starts. The browser removes the claim
   from the fragment and sends it only in the bounded JSON body of `POST
   /api/clinical-records/connect-intents/start`; it must never interpolate the
   bearer into a request path, query, log, or error.
3. Murph discovers the selected endpoint's SMART configuration, requires
   standalone-patient launch and S256 PKCE, and sends the browser to the
   provider. The provider collects portal credentials and patient identity;
   Murph never receives the portal password.
4. The callback consumes the hashed state once, verifies the same Murph app
   session and pinned provider endpoint, exchanges the code, and accepts the
   actual partial grant only when it includes Patient read plus at least one
   granted Epic beta search family.
5. The callback locks the member, rechecks consent and suspension, then
   atomically persists the connection, next retrieval generation and existing
   system-mailbox wake. Reauthorization reuses that connection only after its
   prior run is finalized, with the same patient and FHIR base. The existing
   Temporal handoff sweep re-signals pending work without creating another run.
6. The hosted runtime reads a credential-free run descriptor, asks the web
   control plane for bounded FHIR pages, and imports raw-first evidence through
   the Clinical Records vault use case. The web control plane records only
   operational counts and terminal status; raw FHIR truth stays in the
   encrypted vault.

The records page has one import action through the shared authenticated
launcher. Connect opens provider search immediately after required consent.
The return page shows saved counts, partial or failed status, and a link to
`/biomarkers` only when recognized lab results were saved. Raw evidence does
not imply usable results or a human review queue. Callback replay never claims
that no earlier records were copied. A failed start can retry the same provider;
selecting another starts a fresh document and claim.

Disconnect remains available to authenticated owners after entitlement ends.
It clears temporary credentials and patient context, cancels unfinished runs,
and invalidates older OAuth sessions. Saved outcomes remain visible. Reconnect
and import-again actions follow the same launcher and bounded lifecycle below.

## Ownership and data boundaries

- `apps/web` owns the Epic directory, connect intents, OAuth sessions, SMART
  credentials, patient context, retrieval generations, provider egress, and
  member-facing connection status.
- `packages/hosted-execution` owns the strict credential-free runtime request
  and response contracts plus the `clinical-records.sync-requested` wake.
- `apps/cloudflare` proves the active runtime write fence before proxying the
  three runtime operations. `apps/web` requires the forwarded attempt, lease
  generation, workspace version, signed callback, and bound member.
- `packages/clinical-records`, `packages/importers`, `packages/core`, and
  `packages/vault-usecases` own raw-page integrity, FHIR import decisions,
  canonical mutation, and composed vault execution respectively.
- Postgres stores no raw FHIR resource or record body. Patient ids, access
  tokens, PKCE verifiers, and continuation cursors use
  purpose-specific hosted crypto lanes. The runtime manifest's canonical
  patient-id hash is derived in memory from the decrypted patient context and
  is never stored in plaintext in Postgres. An encrypted patient binding survives
  temporary credential erasure so reauthorization can compare the same patient
  using the existing member/connection/token-version crypto owner. Caller request ids and page URLs are not
  persisted in the web database; only a server-derived run/page fingerprint
  coordinates page claims.
- Provider credentials and patient ids never enter prompts, Temporal workflow
  state, assistant state, or the hosted workspace snapshot. A bounded raw FHIR
  page exists only in the signed web response and the active encrypted-vault
  import path.

## Provider directory

`provider-directory.v2.json` is a committed, versioned build artifact generated
offline from Epic's recommended R4 User-access Brands Bundle. It records the
SHA-256 of the exact source bytes, contains one checked-in Epic acquisition
policy, and lets each provider entry reference that policy instead of repeating
the same SMART scopes and resource list. The official
source page is `https://open.epic.com/MyApps/Endpoints`; its machine-readable
download is `https://open.epic.com/Endpoints/Brands`. Epic explicitly advises
applications to download and re-host this data instead of querying it at
runtime. Runtime search therefore performs no directory network request and
never accepts a caller-supplied FHIR base URL. Provider ids derive from Epic's
stable brand identifier, not an endpoint URL. All published facility tuples
are retained so city/facility matches beyond the first visible results remain
discoverable.

Refresh the artifact from the repository root with:

```bash
curl --fail --location --silent --show-error \
  https://open.epic.com/Endpoints/Brands |
  pnpm --dir apps/web clinical-records:providers:import -- --input -
```

Review the official source provenance and generated diff, then rerun the
provider-directory tests. The importer is byte-deterministic for fixed source
bytes and canonicalizes provider and facility order; the source hash remains
an exact-byte hash, so a reordered source bundle correctly receives a different
hash. The v2 parser rejects duplicate or unsorted ids, unknown policy/query
references, non-HTTPS URLs,
credentials/query/fragment components, and private, loopback, link-local, or
mapped-private IP literals. Only the v2 directory parser remains.

The artifact also carries one curated `Epic Sandbox (test data only)` entry for
Epic's official R4 sandbox. It uses only
`EPIC_SMART_NON_PRODUCTION_CLIENT_ID`; production brands use only
`EPIC_SMART_CLIENT_ID`. There is no fallback between those credentials.

## Epic acquisition policy

`epic-policy.ts` authors one ordered literal query catalog: stable ids,
resource family, operation, fingerprint template, fixed search parameters,
optional executed window, and registration API keys. Scopes, family order and
frozen plans derive from that catalog. All 40 queries across 17 primary families
remain active; each granted family expands into all of its variants. The 70 API
registration entries also cover supporting reads. Runtime performs only the
explicitly bounded Media-to-Binary diagnostic-image hop and no general reference
traversal or backfill. Unused capability metadata is absent; directory presence
is not a capability guarantee.

### Additional patient-facing Epic variants

New plans include radiology DocumentReferences (category `imaging-result`),
external C-CDA documents (`external-ccda`), outside clinical notes
(`external-clinical-note`) and outside vital signs (`external-vital-signs`).
Each uses the authorized patient, normal pagination and its own stable query
identity, with no client date cutoff. Existing search permissions suffice;
register the four additional patient-facing APIs in the Epic app before rollout.
Existing frozen plans retain their original query set.

The variants retain source evidence through the current importer. Linked document
bodies use the separate bounded Binary/dependency acquisition boundary; these
queries do not claim to fetch every attachment or bypass provider release limits.
Official patient-app request contracts: [radiology](https://fhir.epic.com/Specifications?api=10235),
[external C-CDA](https://fhir.epic.com/Specifications?api=10135),
[outside notes](https://fhir.epic.com/Specifications?api=10999), and
[outside vital signs](https://fhir.epic.com/Specifications?api=11422).

## Retrieval contract and limits

Assistant link creation reuses the same signed Web control boundary through
`/api/internal/clinical-records/connect-link`. Message-authorized calls use an
empty object; the route derives the member from the active runtime fence and
returns the existing short-lived first-party connect URL. Scheduled calls may add only a typed
`scheduled_<sha256>` request key derived from the exact occurrence. That form returns
one stable authenticated browser launcher without creating an intent, rotating the
member's current intent, or starting the 15-minute claim TTL. After the member opens
the launcher and authenticates, the existing browser POST creates the ordinary
single-use intent as current human action. Queued delivery and same-occurrence retry
therefore cannot invalidate a newer human link, resurrect a started or completed
OAuth flow, or expire the scheduled link before delivery. A verified private current
request or exact scheduled automation occurrence may invoke that same owner; neither
path can choose a member, provider, or destination in tool arguments.

The scheduled request-key branch permits one bounded exact transport replay after a
retryable failure because it is deterministic and non-mutating. The turn shares one
in-flight or successful launcher request and clears only an exact rejected request so
a later explicit invocation can retry. Message-authorized link creation does not use
automatic transport replay because it creates the live single-use claim.
Once an import is queued, the retrieval runtime uses four signed POST operations:

- `/api/internal/clinical-records/runtime/read-run`
- `/api/internal/clinical-records/runtime/fetch-page`
- `/api/internal/clinical-records/runtime/fetch-document`
- `/api/internal/clinical-records/runtime/record-outcome`

The web control plane fetches only the exact configured FHIR origin and exact
resource-family path. Patient uses a direct patient read; the other 39 primary
queries use their policy-owned patient search template and fixed category where
required. All new queries use a whole-family slice without a client-supplied lower
or upper date cutoff. Clinical notes are no longer limited to 90 days, and
encounters, vaccinations, assessments, social history, procedures and vital signs
are no longer limited to one year. Previously frozen bounded plans resume with
their original `period`, `date` or `issued` parameters; new plans never create
those windows. Whole-family describes the requested date scope, not proof that
a hospital exposed or returned every record. Existing budgets and typed partial
outcomes still apply. Provider redirects are disabled. A continuation must remain
on the same origin and family path; only its query may change. Root pages omit
`pageUrlHash`; continuation pages include it, while the
raw Bundle retains its provider `next` link for the importer to prove a
root-reachable chain. Formally marked Bundle search-outcome entries remain in
raw-page counts but do not enter patient-family mapping. The exact validated provider link text is the provenance
and logical-page identity; URL parsing is used only for network policy and
fetching, and randomized cursor ciphertext never defines page identity. Cursors
remain valid only while their member-bound run and generation remain active.

Limits are 5 MiB per FHIR page, 20 MiB per decoded document, 2,000 document
descriptors and 64 MiB of document bytes while a page is being processed. Each
page and document request is streamed and claimed independently; the old
500-request and 32 MiB cumulative run cutoffs are removed. A final database
integer-capacity guard and bounded replay count remain, and provider, token,
authorization, page-resource and parser limits can still produce explicit
incomplete coverage. The shared FHIR schema admits the 17 primary families plus
the legacy MedicationStatement family, for 18 total.
New runs freeze an adapter-owned retrieval plan with stable query-scope ids and
deterministic slice ids. That plan can represent multiple queries for one FHIR
resource type and ordered, non-overlapping bounded windows without treating
either id as canonical clinical identity. Hosted runs use only `query-slices-v2`. The run-owned frozen slice list is the
single retrieval representation; completed-slice references own completion.
Families and counts are derived. Every page request, opaque cursor,
server-derived request fingerprint, durable request claim, and terminal outcome
is checked against the frozen query-scope and slice identity before provider
egress or outcome mutation. New OAuth requests deduplicate the 40 queries into
17 resource permissions, and each granted family expands back into every active
query variant in the frozen run plan. A partial grant still requires Patient plus
at least one clinical family and executes all active queries for each granted
family.
Each fetch reserves the full page allowance atomically before provider egress,
then settles to the actual received UTF-8 bytes after a valid response,
including whitespace. Normalized snapshot bounds are separate. A provider-side or
ambiguous failure keeps the full reservation charged; a failure before FHIR
egress releases it. Provider bodies are streamed through a bounded reader and
canceled at limit+1 even when `Content-Length` is absent or false. SMART
metadata/token bodies use the same rule at 64 KiB.

Each logical runtime page has one server-derived durable claim, so concurrent
caller request ids for the same cursor cannot fan out provider traffic. A stale
claim can be replaced after 30 seconds, but its late completion cannot increment
logical page counts, settle charged egress, or release the replacement claim.
A completed-page replay remains available for ambiguous in-flight recovery, but
consumes the provider-request and charged-egress budgets without double-counting
the logical page. Normal foreground preemption does not replay completed pages:
vault-usecases atomically records each accepted page and the next unfinished
cursor in one private, portable `.runtime/operations/clinical-records/**`
checkpoint before yielding, and removes it after terminal import or rejection.
The checkpoint is non-canonical; full snapshot validation still happens before
any final raw page or manifest is persisted. The beta requests no
`offline_access` scope, expects no refresh token, and starts its one-shot
retrieval immediately after authorization. On the normal path, an expired
one-shot access token transitions to authorization-required instead of creating
a background refresh lifecycle.
Unqualified single laboratory reference ranges are retained when their numeric
boundaries use units compatible with the result, or when they provide a bounded
text range. Multiple, qualified, inverted, malformed, or unit-incompatible
ranges hold the containing observation for review instead of being dropped.
Preemption requeues the same run without discarding or replaying completed page
progress. Web current-run authority is checked immediately before raw evidence
persistence and immediately before canonical mutation. Final
outcomes are idempotent under JSON key reordering. Runtime checkpoints use v4;
only the external snapshot importer retains local v2/v3 manifest compatibility.
The hosted writer emits v3 manifests and derives outgoing pagination edges
from raw Bundles, preserving root/reachability/cycle/family/base validation.

Completed slices and prior page batches survive an unrelated later byte/page/resource bound. The
unfinished work remains checkpointed for retry without refunding historical charges. Meaningful
OperationOutcome warnings/errors mark coverage incomplete; empty uncertain
searches never establish allergy absence. SMART `.s` grants authorize search.
SUBSETTED resources and unorderable same-identity siblings remain raw evidence
with an explicit incomplete disposition, leaving validated canonical facts
unchanged. Comparable clinical holds retain the existing revision protection.
Web accepts partial received-page counts below served counts, rejects
excess counts, and records same-generation saved counts after authorization
ends without restoring access. Permanent outcome conflicts leave the mailbox
retry loop; transient failures retain it.

### Document enrichment

After each imported FHIR page batch with downloaded attachments, the runtime
durably admits enrichment for that batch's manifest before advancing the
retrieval checkpoint. It does not wait for the whole chart or walk predecessor
manifests. A local `clinical-records.enrichment-requested` mailbox pointer retains
unfinished work and its next wake through the existing `default_owned` runtime
path. Saved structured FHIR results remain available while enrichment runs.

Murph extracts one document page at a time using at most three confined read-only
subagents for labs, measurements and history. Supported evidence includes bounded
text, clinical XML/HTML, PDF pages and PNG/JPEG images. The leaves share a
120-second provider timeout and have no write, tool-network, delivery or delegation
authority. They treat document instructions as untrusted evidence and cannot
choose canonical identities or source paths. Foreground replies can continue
during extraction; snapshots, workspace replacement, fence loss and shutdown
abort and join the exact owned children. Cancellation retains durable work.

Validated proposals are frozen in private operational state. A separate bounded
canonical action derives source identity and raw/page provenance, checks existing
facts, applies accepted proposals, and reads back the writes before advancing.
It makes no model call. The host checks the immutable parent status and uses
the canonical vault timezone for overlap and readback. Derived facts retain
parent revision authority; later corrections or withdrawals retire older
extraction facets, and stale queued proposals become explicit holds. Eligible
scanned documents retain a neutral canonical source receipt even when text
parsing cannot recover content. Lab publication requires supported specimen
and catalog identity; ambiguous labels cannot create conflicting biomarkers.
Equivalent existing facts are skipped; ambiguous facts
are held rather than replacing structured FHIR results. Missing or unsupported
source documents before extraction receive explicit holds so later documents
can progress. Invalid manifests and changes to prepared source bytes fail closed.
Recoverable failures retain bounded retry state; exhausted retries hold the
affected document. Neither retrieval success nor an enrichment receipt proves
that every document or clinical fact was recovered.

### Bounded repeat import

The existing member/provider unique source admits at most eight immutable
retrieval snapshots and a member has at most twenty sources. Each page batch has
its own bounded manifest and raw evidence; prior batches remain immutable and
available to prove continuation. Generations consume that allowance even when a
run fails. No raw evidence is pruned, so canonical raw references remain valid.
This bounds snapshots without a garbage collector, new service or state owner.
Repeated unchanged facts use existing canonical idempotency; newer comparable
corrections use existing revision handling. A fresh authorization increments
both generation and credential epoch under the member lock. Old callbacks,
patient/source changes and stale outcomes cannot replace that generation.

HTTP 401 or a token at or within the retrieval expiry leeway transitions the
current credential version and run to authorization-required. HTTP 403 marks
only that family unavailable.
429/5xx and transport failures are retryable; malformed pages, escaped
pagination fail closed. Configured bounds preserve already-completed valid slices.

## Privacy lifecycle

Health-data withdrawal fences admission immediately through the existing
member consent owner. Clinical cleanup is scheduled before runtime-stop
reconciliation, so a failed stop cannot skip credential/session invalidation
and run cancellation. Cleanup takes the same member lock and rechecks for a
newer consent grant before mutation. Callback persistence also checks member
suspension after locking. Network and crypto preparation remain outside the
persistence transaction; mailbox sealing reuses the prewarmed ingress root. A timestamped
`needs_reauth` run without outcome counts still has unfinished finalization:
disconnect and withdrawal cancel it so it cannot strand reconnect. Runs with
finalized counts retain those results; late outcomes cannot alter a new generation.

Account deletion removes requests, runs, OAuth sessions, intents and encrypted
connections. Normal vault export never exposes control-plane credentials.

## Deployment

Recheck the bounded production aggregate for retained connections, runs,
requests and unconsumed OAuth sessions before removing old hosted readers.
The implementation-time aggregate was zero; that is not a rollout-time proof.
Deploy the additive binding/default migration and compatible Web reader first,
then the current Cloudflare/runner contract. Drain older runner work before
admitting v3 checkpoints; v3-capable runners are the workspace rollback floor.
Do not revert to a runner that cannot read a retained checkpoint.

The four obsolete connection columns and duplicate run family list are removed
from Prisma's reader. Their physical deletion lives in the existing postdeploy
contract-migration lane, never the predeploy Prisma path. Invoke that lane only
with its exact current-production deployment proof after older Web readers
have drained. That Web deployment is then the rollback floor. The drop has
bounded lock/statement timeouts and requires no data backfill. Until it runs,
extra columns with defaults are harmless to both readers. Postdeploy checks:
current Web/Worker/runner versions, no old active runs, ordinary pagination,
saved partial counts, and a same-patient repeat import. Keep signed runtime
fencing throughout; no direct provider-access fallback.

Register an incoming OAuth 2.0 app for the patient consumer with a
non-confidential client and S256 PKCE in
[Epic's app portal](https://fhir.epic.com/Developer/Apps). Select R4, use the
Murph product name without adding `Epic` to the app name, set Automatic
Client Distribution to `None`, and register the following exact 70 names from
Epic's current
[FHIR catalog](https://open.epic.com/Interface/FHIR):

```text
AllergyIntolerance.Search (Patient Chart) (R4)
Binary.Read (Clinical Notes) (R4)
CarePlan.Search (Longitudinal) (R4)
CareTeam.Search (Longitudinal CareTeam) (R4)
Condition.Search (Encounter Diagnosis) (R4)
Condition.Search (Problems) (R4)
Device.Search (Implants) (R4)
DiagnosticReport.Search (Results) (R4)
DocumentReference.Search (Clinical Notes) (R4)
Encounter.Read (Patient Chart) (R4)
Encounter.Search (Patient Chart) (R4)
FamilyMemberHistory.Search (R4)
Goal.Search (Patient) (R4)
Immunization.Search (Patient Chart) (R4)
Location.Read (Organizational Directory) (R4)
MedicationDispense.Search (Fill Status) (R4)
Medication.Read (Organization Med List) (R4)
MedicationRequest.Read (Signed Medication Order) (R4)
MedicationRequest.Search (Signed Medication Order) (R4)
Observation.Read (Assessments) (R4)
Observation.Read (Labs) (R4)
Observation.Search (Assessments) (R4)
Observation.Search (Labs) (R4)
Observation.Search (SDOH Assessments) (R4)
Observation.Search (Social History) (R4)
Observation.Search (Vital Signs) (R4)
Organization.Read (Organizational Directory) (R4)
Patient.Read (Demographics) (R4)
Practitioner.Read (Organizational Directory) (R4)
PractitionerRole.Read (Organizational Directory) (R4)
Procedure.Search (Orders) (R4)
Procedure.Search (Surgeries) (R4)
Procedure.Search (Patient-Reported Surgical History) (R4)
Provenance.Read (R4)
ServiceRequest.Read (Orders) (R4)
ServiceRequest.Search (Orders) (R4)
Specimen.Read (Patient Chart) (R4)
DocumentReference.Search (Radiology Results) (R4)
DocumentReference.Search (External CCDA) (R4)
DocumentReference.Search (Outside Record - Clinical Notes) (R4)
Observation.Search (Outside Record Vital Signs) (R4)
Binary.Read (External CCDA) (R4)
Binary.Read (Outside Record - Clinical Notes) (R4)
Binary.Read (Radiology Results) (R4)
Binary.Read (Labs) (R4)
Binary.Read (Generated CDAs) (R4)
Binary.Read (Patient-Entered Questionnaires) (R4)
Binary.Read (Correspondences) (R4)
Binary.Read (Handoff) (R4)
Binary.Read (Minimum Data Set) (R4)
DocumentReference.Search (Labs) (R4)
DocumentReference.Search (Generated CDAs) (R4)
DocumentReference.Search (Patient-Entered Questionnaires) (R4)
DocumentReference.Search (Correspondences) (R4)
DocumentReference.Search (Handoff) (R4)
DocumentReference.Search (Minimum Data Set) (R4)
Binary.Read (Document Information) (R4)
DocumentReference.Search (Document Information) (R4)
Binary.Read (Clinical References) (R4)
DocumentReference.Search (Clinical References) (R4)
Binary.Read (HIS) (R4)
DocumentReference.Search (HIS) (R4)
Binary.Read (OASIS) (R4)
DocumentReference.Search (OASIS) (R4)
Binary.Read (IRF-PAI) (R4)
DocumentReference.Search (IRF-PAI) (R4)
Binary.Read (Advance Directive) (R4)
DocumentReference.Search (Advance Directive) (R4)
Media.Read (Study) (R4)
Binary.Read (Study) (R4)
```

Registration covers the 40 active primary queries and supporting dependency
reads. Runtime requests 17 unique primary resource permissions plus a separate
patient Binary read permission when document or diagnostic-report access is
requested. Binary remains a supporting body download, never a primary search
family. A useful partial grant without Binary access preserves primary records
and reports linked document bodies as unavailable. Resource families without a canonical mapper
are retained as patient-bound raw evidence with an explicit review decision; no
family is silently dropped. The exact full-coverage registration cannot use
USCDI-v3 automatic distribution: `FamilyMemberHistory.Search (R4)`,
and `Procedure.Search (Patient-Reported Surgical History) (R4)` are absent
from Epic's automatic-distribution appendix. Epic's patient-app registration
also does not offer `Questionnaire.Read`; dependency traversal remains deferred,
so the registration contract omits it instead of substituting unrelated
`QuestionnaireResponse` APIs. Do not substitute Outside Record or SDOH APIs,
because they expose different data surfaces. Each target Epic customer must
instead download/request this client ID. Do not request refresh tokens or
`offline_access`.
[Media.Read (Study)](https://fhir.epic.com/Specifications?api=10989) and
[Binary.Read (Study)](https://fhir.epic.com/Specifications?api=11002) support
the key diagnostic images linked from DiagnosticReport, including cardiology
and endoscopy JPEG/PNG images. Media read permission is requested when
DiagnosticReport is requested; it remains separate from primary-family access.
The document catalog requests lifetime clinical notes, lab narratives and
pathology reports through the shared `clinical-note` search; imaging reports,
external CCDAs, outside notes, generated `summary-document` CCDAs, submitted
`questionnaire-response` PDFs, correspondence and handoff reports have their
own category searches. Explicit category searches also request native stored documents and scans,
clinical reference materials, advance directives, and MDS, HIS, OASIS and
IRF-PAI assessments. Each subtype must be
registered even where Epic shares a request URL. These search and body contracts
are documented in Epic's [clinical notes](https://fhir.epic.com/Specifications?api=1048),
[lab documents](https://fhir.epic.com/Specifications?api=10133),
[generated CDAs](https://fhir.epic.com/Specifications?api=10506),
[questionnaires](https://fhir.epic.com/Specifications?api=10436),
[correspondence](https://fhir.epic.com/Specifications?api=10244),
[handoff](https://fhir.epic.com/Specifications?api=10131) and
[MDS](https://fhir.epic.com/specifications?api=10284),
[native documents](https://fhir.epic.com/Specifications?api=10310),
[clinical references](https://fhir.epic.com/Specifications?api=10318),
[advance directives](https://fhir.epic.com/Specifications?api=40299),
[HIS](https://fhir.epic.com/Specifications?api=10129),
[OASIS](https://fhir.epic.com/Specifications?api=10127) and
[IRF-PAI](https://fhir.epic.com/Specifications?api=10287) specifications.
Epic's IRF-PAI request-parameter table names category `IRFPAI`, while its sample
request names `IRF-PAI`. Both documented spellings have separate lifetime
queries sharing one API registration; an unsupported spelling remains an
explicit incomplete slice for that provider.
The unfiltered DocumentReference search only includes subtypes whose required
parameters are valid; it cannot substitute for these category searches.
Native-document metadata can describe documents stored in an external system,
but Epic does not return their binaries. Outside clinical notes can similarly
omit embedded media.
Generated CDA searches are limited by Epic to 80 per patient per day. They
produce summaries from current clinical content, not an archive of every past
CDA version. Binary search APIs are for Bulk FHIR clients; this patient app uses
[Binary reads](https://fhir.epic.com/Specifications?api=1044). Non-patient scanning
workflows, provider photos and administrative documents are not queried.
[Prior-auth supporting binaries](https://fhir.epic.com/Specifications?api=11398)
are explicitly unavailable to patient-facing applications.
Patient-facing security, unavailable provider subtypes and explicit incomplete
outcomes still limit coverage; the catalog does not assert that every record in
the hospital is exposed.

Epic recommends a separate localhost-only
test app that is never activated. Register the callback with the actual local
port, for example
`http://localhost:3000/api/clinical-records/oauth/callback`, and set
`EPIC_SMART_NON_PRODUCTION_CLIENT_ID` to Epic's non-production client id. The
curated sandbox FHIR base is
`https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4`.

Before production authorization, add the exact HTTPS callback
`https://<production-host>/api/clinical-records/oauth/callback`, keep Automatic
Client Distribution set to `None`, complete Epic's Data Use Questionnaire,
mark the app ready for production, coordinate each customer download, and set
`EPIC_SMART_CLIENT_ID` to Epic's production client id. Preview hosts need their
own registered callback and the non-production client id. A missing exact
client id fails closed before redirect.

## Deliberately deferred

- TEFCA/QHIN participation, CLEAR-style identity proofing, record-locator
  services, and automatic nationwide provider discovery.
- Email scanning for portal/provider inference.
- Cerner/Oracle and provider-specific adapters beyond Epic SMART.
- Background scheduled refresh and provider-directory network refresh jobs.
- Claims-based matching or promises that the result is a complete legal
  medical record.
