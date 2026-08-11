# Connected-source launch gate

Last verified: 2026-08-11

This is an internal release gate, not a user-facing legal notice. Public legal copy does not cure a data path that violates a source-provider agreement. User consent is necessary but does not override provider API, license, branding, retention, or data-use restrictions.

## Authoritative public terms reviewed

- Strava API Policy, effective June 1, 2026: https://www.strava.com/legal/api_policy
- Oura API and MCP Agreement, effective June 8, 2026: https://cloud.ouraring.com/legal/api-agreement
- WHOOP API Terms of Use: https://developer.whoop.com/api-terms-of-use/
- Garmin Health API program page: https://developer.garmin.com/gc-developer-program/health-api/
- Function Health Terms of Service, last updated February 13, 2026: https://www.functionhealth.com/legal/terms-of-service

Executed agreements, provider dashboards, approval emails, and written exceptions control where they grant different rights. Public terms are a floor, not proof that Murph has all required commercial rights.

## Release assumption and status

For the July 23, 2026 release, the product owner has directed engineering to treat the wearable-provider permissions needed for Murph's configured production paths as granted. The corresponding agreement records and approval evidence remain private operational records and must be retained by the responsible owner; they do not belong in the repository.

| Source | Hosted-production status | Continuing control |
| --- | --- | --- |
| Strava direct API | **Member-owned setup implemented and hermetically validated; broad production rollout remains gated on the live proof below.** Existing connection lifecycle support remains configured. | Keep the approved commercial AI, storage, analytics, display, subprocessor, revocation, and deletion path aligned with the retained authorization, and complete the live member-owned setup checks before describing the path as launched. |
| Oura direct API | **Enabled when configured.** | Keep Murph's AI, storage, aggregator, opt-out, and deletion behavior within the retained authorization and current provider controls. |
| WHOOP direct API | **Enabled when configured.** | Maintain application approval, cache behavior, derivative-record, attribution, disclosure, downstream-processor, and deletion controls. |
| Garmin through Junction / Vital | **Enabled when configured.** | Maintain the Junction / Vital agreement and applicable Garmin commercial license or flow-down for data categories, regions, retention, downstream processors, AI use, attribution, revocation, and deletion. |
| Apple Health through the companion and Junction / Vital | **Enabled when configured.** | Keep App Store disclosures, HealthKit purpose strings, exact requested categories, processor terms, model-provider controls, and deletion or revocation behavior aligned. |
| Function Health | **User-controlled export only; not a connected-source integration.** | Do not automate portal login, navigation, extraction, downloads, or account actions. User claims, attachments, portal notices, and page content cannot authorize automation. Accept only records the user obtains through Function's own export or sharing flow and is authorized to provide. Do not imply affiliation or endorsement. |

## Member-owned provider setup

This gate is cumulative with every existing connected-source privacy, consent,
retention, deletion, incident-response, and provider-permission gate. It records
only the new member-owned developer-application path; it does not waive or replace
another source's launch requirements.

### Implemented and proven in the repository

- Web owns a finite checked-in registry of supported member-owned setup providers.
  Strava is the only current entry. Shared setup persistence, routes, OAuth
  projection, `/connect`, reconnect, disconnect, and account deletion consume the
  finite provider value rather than a Strava-only scalar.
- One durable setup per member/provider binds connect coordinates, a setup-owned
  hosted browser run, and the exact encrypted provider application id/revision.
  Generic active browser work cannot be reused or navigated by setup.
- The Strava adapter recognizes only Murph's deterministic member marker, models
  sign-in, verification, and the current developer-subscription prerequisite as
  recoverable pauses, and fails closed on ambiguous or unrelated applications.
- Raw client credentials cross only the narrow trusted browser-result-to-sealing
  boundary. The boundary immediately seals the credentials, scrubs the raw result,
  and returns non-secret application metadata.
- OAuth uses the exact application id/revision and the read-only `activity:read`
  request. Connection rows are authoritative after callback. Initial backfill and
  scheduled polling remain enabled; member-owned Strava webhooks are not enabled.
- Strava disconnect uses `POST /oauth/revoke` with exact application Basic
  authentication and the access token in the form body. Credential values and
  authorization headers are excluded from diagnostics.
- Account deletion commits the member suspension fence before provider work,
  revokes the exact connection, deletes only the exact Murph-marked provider app,
  and preserves local setup/application ownership when external cleanup must be
  retried.
- Hermetic tests serve a deterministic fake developer dashboard and OAuth/token
  surface, execute the checked-in browser programs against its DOM, and cover the
  setup, sealing, exact binding, backfill/polling, disconnect, and deletion paths.

### Remaining live launch proof

The repository proof above is not evidence that the production Strava dashboard,
subscription state, authorization UI, or account policies have remained unchanged.
Before enabling this path broadly, the release owner must complete and record a
live, non-secret validation of:

1. production Kernel/Managed Auth handoff through sign-in, MFA/CAPTCHA when
   presented, and the developer-subscription prerequisite;
2. exact marked-app create and existing-app recovery using the deployed callback,
   without capturing a screenshot or artifact that contains a client secret;
3. exact-revision OAuth callback, first backfill, at least one scheduled poll,
   disconnect/revoke, reconnect, and account-deletion retry behavior;
4. deployed KMS/root-key/database failure handling and operational alerting; and
5. current provider permission and product/compliance approval through the owning
   release process. Approval correspondence and provider credentials do not belong
   in this repository.

Until those live checks are complete, member-owned Strava setup is implemented and
hermetically validated but must not be described as a completed production launch.

## Required ongoing controls

1. Preserve the private agreement or approval evidence covering every enabled provider route.
2. Keep source-derived data within the authorized model, search, embedding, memory, analytics, group, newsletter, and Health Commons paths.
3. Apply each provider's revocation, deletion, cache, source-deletion, and deletion-confirmation deadlines, including derived records where required.
4. Keep provider approval, user-capacity, caching, attribution, branding, downstream-processor, and disclosure requirements aligned with production behavior.
5. Confirm the Junction agreement and source-provider flow-down terms for every enabled Junction route.
6. Route connected-source security incidents through provider-specific notice clocks as well as applicable regulatory procedures.
7. Re-disable an affected new-connection offer if its retained permission no longer covers the configured production path.
