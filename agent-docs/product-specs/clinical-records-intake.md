# Clinical Records Intake

Last verified: 2026-07-21

## Product outcome

Murph can send a member a short records-connect link, let them find a likely
Epic organization by provider, facility, city, state, or postal text, complete
the provider's own SMART-on-FHIR sign-in, and import the authorized record
families into the member's encrypted vault. The common path asks for no portal
password inside Murph and no manual file download.

The Epic beta imports the launch Patient binding, laboratory Observations, and
DiagnosticReport result summaries. It intentionally does not claim a complete
medical record.

This first release is an Epic SMART foundation, not a TEFCA/QHIN replacement.
It does not claim nationwide identity matching, discover every organization a
person has visited, connect email, or retrieve records from a provider that
does not expose a compatible patient-facing SMART endpoint.

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
5. A successful member/provider connection atomically creates its one queued
   retrieval generation and durable system-mailbox wake. A second authorization
   for that member/provider pair fails closed before provider discovery when
   possible and again at the unique persistence boundary. The existing Temporal
   recovery schedule's shared mailbox handoff sweep re-signals at most one
   exact pending item per member, including a current queued-generation wake
   that remains ahead of its mailbox lane watermark. It creates no second run,
   wake, receipt, or retrieval generation.
6. The hosted runtime reads a credential-free run descriptor, asks the web
   control plane for bounded FHIR pages, and imports raw-first evidence through
   the Clinical Records vault use case. The web control plane records only
   operational counts and terminal status; raw FHIR truth stays in the
   encrypted vault.

The later records page can show each active connection and its latest queued,
retrieving, importing, complete, partial, authorization-required, or failed
state. This backend foundation exposes status and disconnect only. Disconnect
immediately clears provider tokens and patient context from the live connection
and cancels its active run while retaining a minimal row for status/history.

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
  tokens, refresh tokens, PKCE verifiers, and continuation cursors use
  purpose-specific hosted crypto lanes. The runtime manifest's canonical
  patient-id hash is derived in memory from the decrypted patient context and
  is never stored in Postgres. Caller request ids and page URLs are not
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
references, malformed capability evidence, non-HTTPS URLs,
credentials/query/fragment components, and private, loopback, link-local, or
mapped-private IP literals. The v1 parser remains available for one
compatibility window.

The artifact also carries one curated `Epic Sandbox (test data only)` entry for
Epic's official R4 sandbox. It uses only
`EPIC_SMART_NON_PRODUCTION_CLIENT_ID`; production brands use only
`EPIC_SMART_CLIENT_ID`. There is no fallback between those credentials.

## Epic acquisition policy

`epic-policy.ts` is the single source of truth for Epic SMART base scopes,
query-scope definitions, required FHIR operations, deterministic query
templates, slicing rules, bounded dependency traversal, and the Epic API keys
that must be registered. All 24 primary query scopes are active. They span 17
unique FHIR resource families because Condition, Observation, and Procedure each
have multiple policy-owned query variants. Provider endpoint presence still does
not establish a provider-specific capability claim; any such claim requires a
sorted capability override with an evidence version.

Dependency policies are purpose-bound, restricted to the selected provider's
FHIR base, capped at traversal depth two, and charged against the parent slice
limits. They are not a generic reference crawler, and dependency reads remain
registration-only until that bounded traversal owner lands.

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
Once an import is queued, the retrieval runtime uses three signed POST operations:

- `/api/internal/clinical-records/runtime/read-run`
- `/api/internal/clinical-records/runtime/fetch-page`
- `/api/internal/clinical-records/runtime/record-outcome`

The web control plane fetches only the exact configured FHIR origin and exact
resource-family path. Patient uses a direct patient read; the other 23 primary
queries use their policy-owned patient search template and fixed category where
required. Fifteen queries use one whole-family slice. Nine use one initial
newest-first bounded slice: clinical notes cover 90 days, and Encounter,
Immunization, assessment, social-history, Procedure, and vital-sign searches
cover 365 days. The frozen run creation time owns both endpoints; searches send
repeated `ge`/`lt` values through the Epic-documented `period`, `date`, or
`issued` parameter. Provider redirects are disabled. A continuation must remain
on the same origin and family path; only its query may change. Root pages omit
`pageUrlHash`; continuation pages include it, while the
raw Bundle retains its provider `next` link for the importer to prove a
root-reachable chain. Formally marked Bundle search-outcome entries remain in
raw-page counts but do not enter patient-family mapping. The exact validated provider link text is the provenance
and logical-page identity; URL parsing is used only for network policy and
fetching, and randomized cursor ciphertext never defines page identity. Cursors
remain valid only while their member-bound run and generation remain active.

Limits are 5 MiB per page, 500 provider fetch attempts, 32 MiB of charged
provider egress per run, 500 Bundle entries per page, and 17 Epic primary
resource families. The shared FHIR schema admits those families plus the legacy
MedicationStatement family, for 18 total.
New runs freeze an adapter-owned retrieval plan with stable query-scope ids and
deterministic slice ids. That plan can represent multiple queries for one FHIR
resource type and ordered, non-overlapping bounded windows without treating
either id as canonical clinical identity. Each run also pins its retrieval
protocol: existing nullable-protocol rows remain legacy until terminal, while
new runs emit `query-slices-v2`. Every query-aware page request, opaque cursor,
server-derived request fingerprint, durable request claim, and terminal outcome
is checked against the frozen query-scope and slice identity before provider
egress or outcome mutation. New OAuth requests deduplicate the 24 queries into
17 resource permissions, and each granted family expands back into every active
query variant in the frozen run plan. A partial grant still requires Patient plus
at least one clinical family and executes all active queries for each granted
family.
Each fetch reserves the full page allowance atomically before provider egress,
then settles to the actual bytes after a valid response. A provider-side or
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
outcomes are idempotent under JSON key reordering. The member/provider unique
connection plus its single generation bound the retained raw-evidence family;
no retry, reconnect, or refresh surface may create another retrieval job until
the vault owns a lifecycle that preserves every canonical raw reference while
bounding retained evidence over time.

HTTP 401 or a token at or within the retrieval expiry leeway transitions the
current credential version and run to authorization-required. HTTP 403 marks
only that family unavailable.
429/5xx and transport failures are retryable; malformed pages, escaped
pagination, and configured bounds fail closed.

## Privacy lifecycle

Account deletion explicitly removes retrieval requests, runs, OAuth sessions,
connect intents, and encrypted connection rows before the member row. The
account-data store coverage registry documents all five stores. Normal vault
export continues to export canonical browser-safe vault projections, not web
control-plane credentials, OAuth state, page fingerprints, or raw provider pages.

## Deployment

Deploy the additive Prisma migration and Web control plane first. Existing run
rows retain the nullable legacy protocol for their entire lifecycle; new runs
pin `query-slices-v2`. The already-compatible reader can consume the new
descriptor during this deploy window, while Web temporarily accepts its page
request without `queryFingerprint` and its legacy aggregate terminal outcome.
Then deploy Cloudflare and the hosted runner so page requests and outcomes echo
the full frozen identity. Remove that narrow compatibility only after all old
runner bundles and in-flight runs they can service have drained and the runtime
rollback floor has advanced. Never fall back to direct unfenced provider access.
After all three surfaces converge, smoke-test both browser-started and
assistant-started links, one legacy run, and one new query-aware run.

Register an incoming OAuth 2.0 app for the patient consumer with a
non-confidential client and S256 PKCE in
[Epic's app portal](https://fhir.epic.com/Developer/Apps). Select R4, use the
Murph product name without adding `Epic` to the app name, set Automatic
Client Distribution to `None`, and register the following exact 37 names from
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
Procedure.Search (Patient-Reported Surgical History) (R4)
Procedure.Search (Surgeries) (R4)
Provenance.Read (R4)
ServiceRequest.Read (Orders) (R4)
ServiceRequest.Search (Orders) (R4)
Specimen.Read (Patient Chart) (R4)
```

Registration covers both the 24 active primary queries and supporting dependency
reads. Runtime requests only the 17 unique primary resource permissions and does
not execute dependency traversal. Resource families without a canonical mapper
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
- Retry, reconnect, and reauthorization after the initial retrieval. Active,
  disconnected, and `needs_reauth` member/provider rows all remain ineligible
  for another OAuth start in this beta. Supporting another generation requires
  a bounded raw-evidence retention lifecycle that preserves every canonical
  raw reference.
- Claims-based matching or promises that the result is a complete legal
  medical record.
