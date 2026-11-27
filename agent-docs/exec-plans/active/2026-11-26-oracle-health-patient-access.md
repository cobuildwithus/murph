# Oracle Health patient access

Status: active (O1 readers and O2 keys/config in review; O3 to O5 pending)
Created: 2026-11-26
Updated: 2026-11-26

## Goal

Members connect an Oracle Health (Millennium, `cerner-fhir`) patient portal
through the existing clinical pipeline. Oracle is a second integration profile:
the control plane, encrypted grants, refresh lease, generation fencing, runtime,
importer, vault and notices stay as they are. No migration, runtime or
Cloudflare release, and no new data recipient.

The v1 plan and its ReviewGPT review are kept outside the repository. The
registered client ID is a confidential credential under the vendor's terms; it
lives only in the hosted secret `ORACLE_SMART_CLIENT_ID`.

## Slices

| PR | Contents | Status |
| --- | --- | --- |
| O1 readers | Profile union, trust rule, SMART v1 pin, Oracle catalog and dispatch, refresh gate, search parser and negotiation, directory policy set, query gate, shared page bound | This PR |
| O2 keys and config | Public JWKS, signer resolution, flags and allowlist (all off) | This PR |
| O3 writer | Oracle start, hidden `oracle-sandbox` entry, `oracle:sandbox:offline` proof | Pending |
| O4 directory | Importer `--oracle-input`, Oracle entries and `sources`, weekly workflow step | Pending |
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
  | DiagnosticReport, DocumentReference, Encounter | `_count=100` | `_lastUpdated` ge/lt |
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

- O3: call `oracleStartsEnabledFor(memberId)` and resolve the client with
  `resolveOracleClientAuth`; write `ORACLE_STORED_CLIENT_REFERENCE` as the
  session `clientId`, never `auth.clientId`; discover with `ORACLE_SMART_ENDPOINT_TRUST`,
  `permissionVersion: "v1"`, `ORACLE_REQUESTED_BASE_SCOPES` and
  `ORACLE_RESOURCE_TYPES`; always write the typed binding; gate processor
  approvals at start; add the hidden sandbox entry and the offline proof.
  Confirm in the secure sandbox whether `_lastUpdated` works for the patient
  persona and the token `aud` form. **Merge gate for O3:** Oracle's Encounter
  docs say `_count` and `status` must accompany `patient`, while the open
  sandbox accepted the v1 query without `status`. The secure-sandbox check must
  settle this, and the catalog entry must change if needed, before O3 merges.
  Any catalog change before the first Oracle run is free; afterwards add a new
  identity.
- O4: emit `ORACLE_ACQUISITION_POLICY` in `policies`, entries with `oracle-` +
  20 hex of sha256 of the exact tenant, `integration`, no client key; add
  `sources`. The parser already accepts that shape.

## Deploy order and rollback

1. Deploy O1/O2 Web to every instance. Hosted runtime and Cloudflare need no
   release: they already accept `cerner-fhir`.
2. The owner registers the JWKS URL, presses Test, adds the DNS TXT record and
   sets both hosted secrets.
3. O3 with starts on for the allowlisted test member only.

Before any Oracle OAuth session or row exists, the floor is current main. After
the first session, O1 is the floor; after the first row, also #5372. Keep the
Oracle JWKS published and the signer configured while any Oracle grant exists.

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
