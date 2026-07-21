# Clinical Records Intake

Last verified: 2026-07-18

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

`provider-directory.v1.json` is a committed, versioned build artifact generated
offline from Epic's recommended R4 User-access Brands Bundle. The official
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
  https://open.epic.com/Endpoints/Brands \
  --output /tmp/epic-user-access-brands.json
pnpm --dir apps/web clinical-records:providers:import -- \
  --input /tmp/epic-user-access-brands.json
```

Review the official source provenance and generated diff, then rerun the
provider-directory tests. The importer is deterministic for a fixed source
bundle. The parser rejects duplicate ids, unsupported resource families,
non-HTTPS URLs, credentials/query/fragment components, and private, loopback,
link-local, or mapped-private IP literals.

The artifact also carries one curated `Epic Sandbox (test data only)` entry for
Epic's official R4 sandbox. It uses only
`EPIC_SMART_NON_PRODUCTION_CLIENT_ID`; production brands use only
`EPIC_SMART_CLIENT_ID`. There is no fallback between those credentials.

## Retrieval contract and limits

Assistant link creation reuses the same signed Web control boundary through
`/api/internal/clinical-records/connect-link`. It accepts only an empty object,
derives the member from the active runtime fence, and returns the existing
short-lived first-party connect URL. Once an import is queued, the retrieval
runtime uses three signed POST operations:

- `/api/internal/clinical-records/runtime/read-run`
- `/api/internal/clinical-records/runtime/fetch-page`
- `/api/internal/clinical-records/runtime/record-outcome`

The web control plane fetches only the exact configured FHIR origin and exact
resource-family path. Patient uses a direct patient read, Observation uses
`patient=<launch-patient>&category=laboratory&_count=100`, and DiagnosticReport
uses `patient=<launch-patient>&_count=100`. Provider redirects are disabled. A
continuation must remain on the same origin and family path; only its query may
change. Root pages omit `pageUrlHash`; continuation pages include it, while the
raw Bundle retains its provider `next` link for the importer to prove a
root-reachable chain. Formally marked Bundle search-outcome entries remain in
raw-page counts but do not enter patient-family mapping. The exact validated provider link text is the provenance
and logical-page identity; URL parsing is used only for network policy and
fetching, and randomized cursor ciphertext never defines page identity. Cursors
remain valid only while their member-bound run and generation remain active.

Limits are 5 MiB per page, 500 provider fetch attempts, 32 MiB of charged
provider egress per run, 500 Bundle entries per page, and three Epic beta
resource families. The shared FHIR schema retains its broader 14-family
superset for future integrations; the Epic directory does not request it.
New runs freeze an adapter-owned retrieval plan with stable query-scope ids and
deterministic slice ids. That plan can represent multiple queries for one FHIR
resource type and ordered, non-overlapping bounded windows without treating
either id as canonical clinical identity. This foundation does not expand the
Epic beta request scopes: Web still emits the current resource-family runtime
descriptor and rejects query-aware page traffic until compatible readers have
deployed.
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

Deploy the additive Prisma migration and Web control plane before enabling the
UI/runtime path. The old Web build ignores the new tables. Then deploy
Cloudflare and the hosted runner so their exact allowlist and optional Clinical
Records capability converge. An old runner simply omits assistant link
creation; a new runner against an old Cloudflare or Web deployment fails closed
without creating an intent. Browser connection remains available once Web is
current. Never fall back to direct unfenced provider access. After all three
surfaces converge, smoke-test both browser-started and assistant-started links.

Register an incoming OAuth 2.0 app for the patient consumer with a
non-confidential client and S256 PKCE in
[Epic's app portal](https://fhir.epic.com/Developer/Apps). Select R4, USCDI v3,
use the Murph product name without adding `Epic` to the app name, and select only
[Patient.Read](https://fhir.epic.com/Specifications?api=931),
[Observation.Search (Labs)](https://fhir.epic.com/Specifications?api=999), and
[DiagnosticReport.Search (Results)](https://fhir.epic.com/Specifications?api=989).
Do not request refresh tokens. Epic recommends a separate localhost-only test
app that is never activated. Register the callback with the actual local port,
for example `http://localhost:3000/api/clinical-records/oauth/callback`, and set
`EPIC_SMART_NON_PRODUCTION_CLIENT_ID` to Epic's non-production client id. The
curated sandbox FHIR base is
`https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4`.

Before production authorization, add the exact HTTPS callback
`https://<production-host>/api/clinical-records/oauth/callback`, enable
Auto-download, complete Epic's Data Use Questionnaire, mark the app ready for
production, and set `EPIC_SMART_CLIENT_ID` to Epic's production client id.
Preview hosts need their own registered callback and the non-production client
id. A missing exact client id fails closed before redirect.

## Deliberately deferred

- TEFCA/QHIN participation, CLEAR-style identity proofing, record-locator
  services, and automatic nationwide provider discovery.
- Email scanning for portal/provider inference.
- Cerner/Oracle and provider-specific adapters beyond Epic SMART.
- Background scheduled refresh and provider-directory network refresh jobs.
- Vital-sign Observations. The query/slice acquisition identity now supports a
  second Observation query, but enabling it still requires the follow-up Epic
  scope policy, canonical mapping, and production wire cutover.
- Retry, reconnect, and reauthorization after the initial retrieval; these
  require a bounded raw-evidence retention lifecycle before they can create
  another retrieval job.
- Claims-based matching or promises that the result is a complete legal
  medical record.
