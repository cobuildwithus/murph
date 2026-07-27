# Legal Consent Implementation

Last verified: 2026-07-23

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
- `POST /api/legal/consent/revoke`

All routes require authenticated hosted member context. Launch-required consent can be accepted but not revoked through the revoke endpoint. Optional feature scopes can be granted and revoked independently.
The `POST` accept and revoke routes also enforce hosted mutation-origin checks before writing consent state.

## Consent Scopes

Current scopes are defined in `apps/web/src/lib/legal/consent.ts`:

| Scope | Revocable | Purpose |
| --- | --- | --- |
| `launch.legal` | No | Terms, privacy policy, and Health AI safety disclosure acceptance. |
| `launch.health-data` | No | Consumer health-data notice consent required for launch use. |
| `feature.health-ai` | Yes | Optional health-AI processing consent. |
| `feature.health-commons-contribution` | Yes | Optional contribution of normalized results to Health Commons learning. |
| `feature.connected-health-source` | Yes | Optional connected-source processing consent beyond explicit launch consent and connect action. |

## Gate Helpers

Server-only helpers in `apps/web/src/lib/legal/consent.ts` provide:

- document registry and scope definitions;
- current consent status reads;
- launch-required consent recording;
- optional feature consent grant/revocation;
- `assertHostedConsentScopeGranted`;
- `assertHostedHistoricalLaunchConsentGranted`;
- `assertHostedLaunchRequiredConsentGranted`.

Browser-vault session creation requires current launch-required consent before reading hosted vault state. Device-sync connection and reconnection setup require both historical launch grants but intentionally ignore launch-document freshness: the member must also have an active authenticated session, take an explicit connect action, and complete the source provider's authorization flow. Current companion device status, token exchange, and sync ingestion use the same historical-launch boundary, so an existing authorized member remains available when document acceptance becomes stale while a member with zero or partial launch consent remains fail-closed. These device paths do not require a second connected-source consent grant because the explicit source action and provider authorization supply the feature intent. Future feature gates should follow the same pattern at the boundary where hosted processing would otherwise begin and should introduce separate optional scopes only when they cover distinct data use beyond the explicit source authorization.

## Document updates and existing members

A grant is current only when its recorded document-version snapshot exactly matches every document required by that scope. Publishing a new required version therefore preserves the old append-only acceptance event as historical evidence but makes the corresponding current grant stale. Members do not lose their account, subscription, data, device connection, or container when that happens.

The authenticated dashboard layout reads consent status before starting the browser-vault provider. A member with both historical launch grants and stale document versions sees the current legal card alongside the requested dashboard route; the reminder does not replace or block the device-connect page. Members with zero or partial launch consent do not receive update-specific copy. Accepting both launch scopes reloads that exact route and restores protected vault-backed features. If the reminder status cannot be read, the layout omits the reminder instead of taking device connection down. The public `/design` catalog injects an in-memory acceptance handler and inert handoff into the production component, so its interactive preview never calls the consent API or writes consent state.

The ordinary Linq inbound webhook, mailbox ingestion, hosted container wake, and current-conversation reply path do not use launch consent as an admission gate. Configured non-Strava device connection/reconnection and current companion device sync require both historical launch grants but not current document versions. A stale document version therefore does not stop an existing authorized member from texting Murph, receiving a reply in that active conversation, connecting an available device, or continuing current device sync. A member with zero or partial launch consent cannot start or use those health-data device paths. Native or chat-adjacent actions with no current-document consent UI of their own — reaction-based group joins, meal-photo enrollment and uploads, and iMessage mini-app proof actions — use the same historical-launch boundary as device sync. Meal-photo enrollment still requires a foreground verified Privy identity, active member access, explicit Photos opt-in, and a current private delivery route. Independently guarded browser-vault, clinical-record, export, billing, web group-join, and iMessage mini-app enrollment actions still fail closed with `HOSTED_CONSENT_REQUIRED` until the member accepts the current documents. Strava remains disabled for new connections and reconnect offers as a separate provider product gate.

## Privacy Notes

Consent events store document versions and coarse source labels only. They do not store raw IP addresses, user agents, prompts, health payloads, or legal document text. If future requirements need stronger provenance, add minimized, documented fields rather than storing raw request metadata.
