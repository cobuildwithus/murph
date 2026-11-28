# Oracle Health patient access

Status: active (O1–O3 merged, O4 in review, O5 pending)
Created: 2026-11-26
Updated: 2026-11-27

## Goal

Members connect an Oracle Health (Millennium, `cerner-fhir`) patient portal
through the existing clinical pipeline. Oracle uses the existing grant, refresh
lease, generation fence, importer and vault owners. O4 coordinates the
long-page timeout across Web and the separate hosted runtime release.

The v1 plan and its ReviewGPT review are kept outside the repository. The
registered client ID is a confidential credential under the vendor's terms; it
lives only in the hosted secret `ORACLE_SMART_CLIENT_ID`.

## Slices

| PR | Contents | Status |
| --- | --- | --- |
| O1 readers | Profile union, trust rule, SMART v1 pin, Oracle catalog and dispatch, refresh gate, search parser and negotiation, directory policy set, query gate, shared page bound | Merged |
| O2 keys and config | Public JWKS, signer resolution, flags and allowlist (all off) | Merged |
| O3 writer | Oracle start, hidden `oracle-sandbox` entry, `oracle:sandbox:offline` proof | Merged |
| O4 directory | Importer `--oracle-input`, Oracle entries and `sources`, weekly workflow step | In review |
| O5 copy and docs | Assistant wording, intake spec, `agent-docs/references/oracle-health-patient-access.md`, unbranded changelog | Pending |

## Decisions (as built in O1/O2)

- **Saved profile.** `{ integration: "oracle-millennium-r4", environment, method: "private_key_jwt" }`
  joins the Epic profile in one union (`oracle-integration.ts`), read from the
  encrypted callback binding and refresh payload. Profile-less bindings and
  payloads stay Epic legacy. An Oracle row without its profile, or an Epic row
  with one, fails closed before egress. No key ID is saved.
- **Trust rule.** Only for an Oracle profile, and only when the FHIR base is
  exactly `https://fhir-myrecord.cerner.com/r4/{T}` with `{T}` matching
  `[A-Za-z0-9-]{1,64}`. The authorization endpoint's href must equal
  `https://authorization.cerner.com/tenants/{T}/protocols/oauth2/profiles/smart-v1/personas/patient/authorize`
  and the token endpoint's href must equal
  `https://authorization.cerner.com/tenants/{T}/hosts/fhir-myrecord.cerner.com/protocols/oauth2/profiles/smart-v1/token`.
  Exact href equality rejects other tenants (case-sensitive), other hosts,
  ports, userinfo, queries, fragments and non-HTTPS. The callback and refresh
  revalidate the saved token URL. Page, Binary and Media rules stay same-origin.
- **SMART v1 pinned.** Discovery takes an optional permission version that
  requires the matching capability. Epic keeps v2-first selection. With v1 the
  scope is `patient/{Family}.read`, so the shared scope reader serves both
  catalogs; a test locks every Oracle family through it.
- **Catalog** (`oracle-policy.ts`): 18 queries over 17 families. Fingerprints
  derive from the complete request shape, including the daily filter, so an
  edit makes a new identity instead of reinterpreting a frozen run. Slices
  resolve only inside their own vendor's catalog; Epic URLs are unchanged and
  replayed byte-for-byte through the dispatch.

  | Family (query id) | Fixed parameters | Daily filter |
  | --- | --- | --- |
  | Patient (`patient-demographics`) | read | none |
  | Observation (`observations`) | `_count=200` | `_lastUpdated` ge/lt |
  | Condition, AllergyIntolerance, Procedure | none | `_lastUpdated` ge/lt |
  | DiagnosticReport, DocumentReference | `_count=100` | `_lastUpdated` ge/lt |
  | Encounter (`encounters-{status}`, one query per status) | `_count=100`, `status` = `planned`, `in-progress`, `finished` or `cancelled` | `_lastUpdated` ge/lt |
  | MedicationRequest, ServiceRequest (`service-requests`) | `_count=100` | `_lastUpdated` ge/le |
  | ServiceRequest (`service-request-referrals`) | `category=http://snomed.info/sct\|386053000`, `_count=100` | `_lastUpdated` ge/le |
  | Immunization | none | whole-family (one lower bound only) |
  | MedicationDispense | `_count=100` | whole-family (one lower bound only) |
  | Device, FamilyMemberHistory, Goal, CareTeam | none | whole-family |
  | CarePlan | `category=assess-plan` | whole-family |

  The daily cadence matches Epic: a seven-day overlapping window ending one day
  ahead, and lifetime every seventh check.
- **Gates.** Page and document egress for `cerner-fhir` runs needs catalog
  membership (otherwise permanent `query-unavailable`) and no kill switch. The
  kill switch refusal `integration-disabled` is retryable: an open import keeps
  its runtime checkpoint and resumes once traffic is allowed, instead of losing
  slices until the seventh-check lifetime pass. Daily admission backs off one
  day while it is on. Starts stay Epic-only until O3; an Oracle entry fails with
  `PROVIDER_NOT_CONFIGURED`.
- **Client ID storage.** Oracle treats the client ID as a credential, so the
  OAuth session's `client_id` column and the sealed refresh payload hold the
  fixed reference `ORACLE_STORED_CLIENT_REFERENCE`, never the raw ID. The signer
  reads `ORACLE_SMART_CLIENT_ID` at use; any other stored value fails with
  `PROVIDER_CONFIGURATION_CHANGED` before egress. A grant issued to an earlier
  registration is not detected locally; Oracle rejects it at refresh and the
  member reconnects. Epic sessions keep their stored client IDs.
- **Refresh.** Oracle does not rotate; the existing no-successor path re-seals
  the original token. Lease, generation fencing and ambiguous-exchange reauth
  are unchanged.
- **Search negotiation.** The browser keeps `X-Clinical-Directory-Version: 2`
  and adds `X-Clinical-Directory-Sources: epic-fhir,cerner-fhir`. Without that
  header the server returns Epic rows only, so loaded older tabs keep working
  and old servers ignore the header. Vendor filtering runs before ranking,
  grouping and the 20-result cap. Oracle rows also need
  `CLINICAL_RECORDS_ORACLE_SEARCH=1` and no kill switch. The companion route
  opts in to every enabled vendor; its projection has no vendor field.
- **Directory.** Each listed policy must equal a server-owned definition
  (`[Epic, Oracle]`); an artifact lists only the ones it uses, so the current
  Epic-only artifact still loads. Oracle entries need `integration`, an
  `oracle-` id and no client key.
- **Page bound.** Web admits up to `CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE`
  (1,000) Bundle entries per page instead of a separate 500.
- **Signer and flags.** `ORACLE_SMART_CLIENT_ID` plus
  `ORACLE_SMART_PRIVATE_KEY_PEM` must match the one key in
  `public/.well-known/oracle/production.jwks.json` (RS384, kid
  `murph-oracle-production-4D9w9oKpPTN3`). No sandbox key set is published, so
  a `sandbox` profile fails closed. Flags: `CLINICAL_RECORDS_ORACLE_STARTS`,
  `CLINICAL_RECORDS_ORACLE_MEMBER_IDS` (exact opaque IDs),
  `CLINICAL_RECORDS_ORACLE_SEARCH`, `CLINICAL_RECORDS_ORACLE_DISABLED`
  (stops callbacks, refreshes, pages and documents; records stay). Enabling
  flags need exactly `1`; the kill switch is on for any value except empty,
  `0` or `false` (trimmed, case-insensitive).

## Review dispositions

1. Per-query date parameter and range shape: accepted, implemented as above.
2. Search capability negotiation: accepted; a separate capability header
   instead of a new version value, so a new browser on an old server keeps
   grouped Epic results.
3. Web's literal 500-entry limit: accepted, replaced by the shared bound.
4. Referral ServiceRequest query: accepted, separate id and fingerprint.
5. athenahealth nonce: accepted, deferred to the athena delta. Bind a per-session
   nonce in the existing OAuth session binding; if an ID token is consumed,
   validate its claims and nonce; keep patient-context binding as the identity.
   Do not change Epic or Oracle requests for it.
6. NextGen practice slots: accepted, deferred to NextGen. Keep distinct
   provider slots per practice grant even on a shared base; grouping stays
   display-only; never weaken the patient-binding check.

Trust and compatibility notes accepted: the Oracle binding must be intrinsic to
an Oracle start, independent of `CLINICAL_RECORDS_WRITE_GRANT_PROFILES` (O3);
the O1 reader floor applies once Oracle OAuth sessions exist; a FHIR 401 moves
straight to reauthorization today (plan §7 corrected; no renewal-on-401 path).

## O3 and O4 handoff

- O3 requires the profile writer, starts flag and allowlist before discovery.
  The sandbox uses its own client, matching published key, tenant and exact
  loopback callback. Existing grants continue with writer flags off. The
  clinical intake spec owns the proof command and registration steps.
- Encounter `status`: Oracle's Encounter search docs and the secure patient
  tenant's CapabilityStatement both require `status` with `patient`, and list
  four values. A comma-separated list returned HTTP 500 on the open sandbox,
  while each single value (with and without the `_lastUpdated` window)
  returned a Bundle. The catalog therefore has one Encounter query per status.
  **Enable gate for Oracle starts:** the `oracle:sandbox:offline` Encounter
  step must pass on the secure sandbox before `CLINICAL_RECORDS_ORACLE_STARTS`
  is turned on for anyone. O3 can merge first because all Oracle egress stays
  behind the flags and the sandbox key set has to be published before Oracle
  can register it. Any catalog change before the first Oracle run is free;
  afterwards a new query identity only reaches new connections (each daily
  plan is built from the previous plan's slices), so existing connections need
  a reconnect or an explicit migration.
- O4: emit `ORACLE_ACQUISITION_POLICY` in `policies`, entries with `oracle-` +
  20 hex of sha256 of the exact tenant, `integration`, no client key; add
  `sources`. The parser already accepts that shape.

## Deploy order and rollback

1. Deploy O1/O2 Web to every instance. Hosted runtime and Cloudflare need no
   release: they already accept `cerner-fhir`.
2. The owner registers the JWKS URL, presses Test, adds the DNS TXT record and
   sets both hosted secrets.
3. O3 with starts on for the allowlisted test member only.

Before any Oracle OAuth session or row exists, the floor is current main.
After the first Oracle session of either environment, O3 is the floor: older
Web knows only the single `encounters` slice, so its daily sync drops the four
`encounters-{status}` slices, refuses queued ones as `query-unavailable`
(not retried), and the next plan is built without them, so that connection
loses Encounters until the member reconnects even after rolling forward
again. Older readers also refuse sandbox profiles and ask to reconnect.
After the first row, #5372 is also a floor. Keep the Oracle JWKS published and the signer
configured while any Oracle grant exists.

### O4 directory and retrieval rollout

The initial batch belongs in a human-reviewed PR. The weekly job admits a new
tenant only after a production entry establishes its host and registration.
The importer uses the same case-sensitive tenant grammar as O3. At the pinned
revision, 96 addresses contain underscores and remain outside that grammar.

Keep starts and search off during deployment. Deploy Web and then the manually
released Cloudflare Worker, port and runner image. Each can run against the
previous version. Only an end-to-end fetch-page capability hint and a saved
Oracle whole-family search select the 65-second provider deadline. The Worker
allows 100 seconds for that callback and the runner port 105, the same 5-second
margin the Worker environment requires of the runner commit timeout. An older
component keeps the 20-second provider path. A negotiated page's claim ceiling
scales with its wider window, from 20 to 65, so foreground interruptions cost
no more per second of provider wait. Retryable gateway errors resume through
the existing checkpoint and mailbox delay. O4 adds no persistent format or rollback floor.
Keep O3 Web and the signer once an Oracle session exists.

## Verification

- Focused Web suites: Oracle catalog/trust/signer, retrieval boundary (Epic
  replay, page bounds, `-pageContext`, kill switch, importer round trip),
  control-plane callbacks, daily refresh and admission, directory policy set,
  search negotiation, client parser and published key sets.
- Runtime: a synthetic `cerner-fhir` descriptor through read-run, fetch-page,
  fetch-document and record-outcome with the real vault importer.
- Web typecheck and lint, `pnpm complexity:diff`, the touched PostgreSQL suites.

### O1/O2 evidence

The Web clinical and adjacent suites passed 782 tests (PostgreSQL-gated suites
skipped in that lane). The runtime clinical suite passed, including both
`cerner-fhir` contract cases, and the hosted-execution contract suite passed.
Web, runtime and hosted-execution typechecks and Web lint exited 0. On an
isolated migrated database the account-deletion suite passed and the daily
admission suite passed 63 of 64. The one failure was a nested Cloudflare
process that hit its 90-second timeout while the shared machine's load average
was above 900; that path does not touch Oracle code. CI's PostgreSQL lane owns
the final run. No sandbox or production Oracle traffic occurred.
