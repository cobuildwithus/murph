# Legal Consent Implementation

Last verified: 2026-07-30

## Purpose

Hosted Murph records explicit legal consent for launch-required health-data processing and separate optional feature consents. The implementation keeps an append-only event history plus a current grant table so API gates can check consent quickly without losing audit history.

## Documents

The current launch-required document set is:

- Terms of Service: `apps/web/legal/terms-of-service.md`
- Privacy Policy: `apps/web/legal/privacy-policy.md`
- Consumer Health Data Notice: `apps/web/legal/consumer-health-data-notice.md`
- Health AI Safety Disclosure: `apps/web/legal/health-ai-safety-disclosure.md`

The legal PDF generator writes latest PDFs, versioned PDFs, compatibility aliases where needed, and `/legal/manifest.json`. The manifest is deterministic and intentionally omits generated timestamps.

## Data Model

Hosted consent state lives in `apps/web` Postgres:

- `hosted_consent_event`: append-only consent events with member id, scope, action, accepted document versions, source, and creation time.
- `hosted_consent_grant`: current grant state keyed by member id and scope, with grant/revocation timestamps and the last consent event id.

This is hosted operational/product-control state, not canonical local vault health truth. Rows cascade when a hosted member is deleted, and hosted account export/deletion includes these stores.

## API Surface

The hosted consent API routes are:

- `GET /api/legal/consent/status`
- `POST /api/legal/consent/accept`
- `POST /api/legal/consent/decline`
- `POST /api/legal/consent/revoke`
- `GET /api/device-sync/companion/legal-consent`
- `POST /api/device-sync/companion/legal-consent`

All routes require authenticated hosted member context. The launch legal
agreement is immutable through the revoke endpoint. Health-data consent and
optional feature scopes can be revoked independently.
The `POST` accept, decline, and revoke routes also enforce hosted
mutation-origin checks before writing consent state. Decline records one
`declined` event for each currently ungranted launch scope and ends the current
hosted app session with the coarse `consent_declined` reason. The event ids are
deterministic for the member, session, and scope, so retrying the same decline
does not duplicate the audit history. Session termination remains authoritative
if the scoped event write is temporarily unavailable; the session reason
preserves the refusal outcome without keeping the person signed in.
The companion route uses Privy bearer authentication with no cookie fallback
and accepts only the two launch scopes. It reads and writes the same consent
tables and current server-side document registry as the browser routes. The
iOS and Android clients therefore do not persist a second consent decision or
hardcode document versions, and the route assigns its own generic
`native-companion` audit source instead of trusting a client platform label. One
native action may submit the currently missing launch scopes sequentially and
resume only after the returned status is launch-granted.

## Consent Scopes

Current scopes are defined in `apps/web/src/lib/legal/consent.ts`:

| Scope | Revocable | Purpose |
| --- | --- | --- |
| `launch.legal` | No | Terms, privacy policy, and Health AI safety disclosure acceptance. |
| `launch.health-data` | Yes | Consumer health-data notice consent required for hosted health-data processing. |
| `feature.health-ai` | Yes | Optional health-AI processing consent. |
| `feature.health-commons-contribution` | Yes | Optional contribution of normalized results to Health Commons learning. |
| `feature.connected-health-source` | Yes | Optional connected-source processing consent beyond explicit launch consent and connect action. |

## Gate Helpers

Server-only helpers in `apps/web/src/lib/legal/consent.ts` provide:

- document registry and scope definitions;
- current consent status reads;
- launch-required consent recording;
- revocable consent-scope grant/revocation;
- explicit health-data consent state resolution (`granted`, `revoked`, or
  `missing`);
- `assertHostedConsentScopeGranted`;
- `assertHostedHistoricalLaunchConsentGranted`;
- `assertHostedLaunchRequiredConsentGranted`.

Browser-vault session creation requires current launch-required consent before reading hosted vault state. Device-sync connection and reconnection setup require both historical launch grants but intentionally ignore launch-document freshness: the member must also have an active authenticated session, take an explicit connect action, and complete the source provider's authorization flow. Current companion device status, token exchange, and sync ingestion use the same historical-launch boundary, so an existing authorized member remains available when document acceptance becomes stale while a member with zero or partial launch consent remains fail-closed. These device paths do not require a second connected-source consent grant because the explicit source action and provider authorization supply the feature intent. Future feature gates should follow the same pattern at the boundary where hosted processing would otherwise begin and should introduce separate optional scopes only when they cover distinct data use beyond the explicit source authorization.

## Health-data withdrawal and renewal

Settings exposes health-data withdrawal separately from account deletion. A
confirmed withdrawal writes `launch.health-data = revoked` before attempting
cleanup. That durable grant is the processing authority boundary: explicit
revocation immediately fails closed at AI and message admission, queued runtime
usage admission, new health-source connection, device webhook, scheduled sync,
and companion health-processing boundaries.

Consent grant/revocation and health-processing admissions serialize on the
hosted member row, with connection-level locks acquired afterward. Connection
establishment, webhook, scheduled-sync, companion, and meal-photo credential
writes therefore re-read consent inside the same transaction that persists
work. An explicitly revoked exact message sender or shared-data grantor is
excluded even when another group participant keeps the synthetic room runtime
active.

After revocation commits, the route synchronously calls the Cloudflare
per-user runner's health-data consent barrier. That barrier serializes with
every runtime ensure, re-reads the Web-owned grant through a signed callback,
clears the active write fence, and destroys the runner container before a
revoked result can be acknowledged. Every later ensure performs the same
current-grant read before starting or waking work. Withdrawal returns only
after that stop succeeds.

Provider cleanup remains separate and best effort after the response: the
device-connection and meal-photo owners each re-read consent at their own
mutation boundary so delayed cleanup cannot undo renewed consent. Cleanup
failure does not restore consent or resume processing; repeating withdrawal
retries cleanup without appending another consent event. A missing legacy grant
is a distinct state and cannot be turned into an explicit withdrawal by the
withdrawal endpoint.

Withdrawal does not delete the member account, existing data, or subscription.
Settings, account export, and account deletion remain available. Export uses
the latest retained vault replica without asking the paused runtime to refresh
it, even when that replica is older or marked dirty. The export route owns that
authoritative decision; a stale Settings-page consent projection cannot reject
a route-authorized retained replica. Copy must describe the artifact as the
latest retained data and disclose that unprocessed changes may be absent.

`Use Murph again` presents the existing health-data consent documents and
records a new grant through the ordinary acceptance route. Processing authority
returns only after that grant is durable. Renewal first waits behind any earlier
Cloudflare stop barrier, commits the grant, and signals the existing Temporal
workflow to re-check processing. Provider credentials revoked during cleanup
are not recreated automatically; Settings links to the normal source-management
flow so the member can review or reconnect them.

## Document updates and existing members

A grant is current only when its recorded document-version snapshot exactly matches every document required by that scope. Publishing a new required version therefore preserves the old append-only acceptance event as historical evidence but makes the corresponding current grant stale. Members do not lose their account, subscription, data, device connection, or container when that happens.

The authenticated dashboard layout reads consent status before starting the
browser-vault provider. While launch consent is absent or stale, the requested
route stays mounted but the browser-vault provider exposes an empty context,
starts no session request, and clears any decrypted warm snapshot that may have
loaded before the server check. The layout places the current consent card in a
non-dismissible modal over the inert dashboard, except on `/records/connect`
and on `/settings` for an explicitly withdrawn member.

A member with both historical launch grants and stale document versions sees
update-specific copy; members with zero or partial launch consent see generic
recovery copy. The reminder does not replace or block the device-connect page.
Accepting the required launch scopes reloads that exact route and restores
protected vault-backed features. Settings remains reachable so an explicitly
withdrawn member can renew consent, export data, or delete the account. If the
reminder status cannot be read, the layout omits
the reminder and leaves the ordinary provider path enabled instead of taking
device connection down. The public `/design` catalog injects an in-memory
acceptance handler and inert handoff into the production component, so its
interactive preview never calls the consent API or writes consent state.

The ordinary Linq inbound webhook, mailbox ingestion, hosted container wake,
and current-conversation reply path do not require current launch-document
versions and do not interpret a missing legacy health-data row as withdrawal.
They do reject an explicit `launch.health-data = revoked` state before message
append or model work. Country/prefix-gated Linq instant start may grant the
existing no-card Pulse trial without current launch consent solely so that same
authenticated inbound conversation can receive a reply; it does not override
an explicit withdrawal or relax any independently consent-gated browser,
connected-source, sharing, export, paid-billing/payment-method, or
clinical-record action.

Configured non-Strava device connection/reconnection and current companion
device sync require both historical launch grants but not current document
versions. A stale document version therefore does not stop an existing
authorized member from texting Murph, receiving a reply in that active
conversation, connecting an available device, or continuing current device
sync. Explicit withdrawal does stop those health-data paths. A member with zero
or partial launch consent cannot start or use those health-data device paths,
but that absence remains distinct from withdrawal for legacy compatibility.
Native or chat-adjacent actions with no current-document consent UI of their
own — reaction-based group joins, meal-photo enrollment and uploads, and
iMessage mini-app member actions — use the same historical-launch boundary as
device sync. Meal-photo enrollment still requires a foreground verified Privy
identity, active member access, explicit Photos opt-in, and a current private
delivery route. Independently guarded browser-vault, clinical-record, billing,
web group-join, and iMessage mini-app enrollment actions still fail closed with
`HOSTED_CONSENT_REQUIRED` until the member accepts the current documents.
Account export is the withdrawal exception described above. Strava remains
disabled for new connections and reconnect offers as a separate provider
product gate.

If a companion health-data action encounters zero or partial historical launch
consent, the native app keeps the Privy member session, closes Junction and
automatic meal-photo authority, and presents the server-provided launch
documents in-app. Accepting every missing launch scope re-runs the blocked
native action. Home, legal links, account deletion, and sign-out remain
available while those health-data bridges are paused.

## Privacy Notes

Consent events store document versions and coarse source labels only. Decline
events add no request metadata or free-form client input. Consent events do not
store raw IP addresses, user agents, prompts, health payloads, contact details,
or legal document text. If future requirements need stronger provenance, add
minimized, documented fields rather than storing raw request metadata.
