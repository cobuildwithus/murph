# Legal Consent Implementation

Last verified: 2026-05-13

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
- `assertHostedLaunchRequiredConsentGranted`.

Browser-vault session creation requires current launch-required consent before reading hosted vault state. Device-sync connection setup requires current launch-required consent before starting a provider OAuth flow; the user's explicit connect action supplies the feature intent for that source, so the connect flow does not require a second connected-source consent grant. Future feature gates should follow the same pattern at the boundary where hosted processing would otherwise begin and should introduce separate optional scopes only when they cover distinct data use beyond launch consent plus an explicit user action.

## Privacy Notes

Consent events store document versions and coarse source labels only. They do not store raw IP addresses, user agents, prompts, health payloads, or legal document text. If future requirements need stronger provenance, add minimized, documented fields rather than storing raw request metadata.
