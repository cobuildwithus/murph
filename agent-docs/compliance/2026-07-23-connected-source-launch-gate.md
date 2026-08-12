# Connected-source launch gate

Last verified: 2026-08-12

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
| Strava direct API | **New connections and reconnect offers disabled.** Existing connection lifecycle support remains configured. | Keep the approved commercial AI, storage, analytics, display, subprocessor, revocation, and deletion path aligned with the retained authorization before changing this product gate. |
| Modern Dexcom through Junction / Vital | **New connections disabled; exact existing-account recovery retained.** The legacy Dexcom G6 and older route remains available when configured. | Require live member-owned `dexcom_v3` recovery evidence before Web or assistant connect-link issuance and again before provider start. Keep fresh offers closed until the retained Dexcom and Junction approvals cover production use. |
| Oura direct API | **Enabled when configured.** | Keep Murph's AI, storage, aggregator, opt-out, and deletion behavior within the retained authorization and current provider controls. |
| WHOOP direct API | **Enabled when configured.** | Maintain application approval, cache behavior, derivative-record, attribution, disclosure, downstream-processor, and deletion controls. |
| Garmin through Junction / Vital | **Enabled when configured.** | Maintain the Junction / Vital agreement and applicable Garmin commercial license or flow-down for data categories, regions, retention, downstream processors, AI use, attribution, revocation, and deletion. |
| Apple Health through the companion and Junction / Vital | **Enabled when configured.** | Keep App Store disclosures, HealthKit purpose strings, exact requested categories, processor terms, model-provider controls, and deletion or revocation behavior aligned. |
| Function Health | **User-controlled export only; not a connected-source integration.** | Do not automate portal login, navigation, extraction, downloads, or account actions. User claims, attachments, portal notices, and page content cannot authorize automation. Accept only records the user obtains through Function's own export or sharing flow and is authorized to provide. Do not imply affiliation or endorsement. |

## Required ongoing controls

1. Preserve the private agreement or approval evidence covering every enabled provider route.
2. Keep source-derived data within the authorized model, search, embedding, memory, analytics, group, newsletter, and Health Commons paths.
3. Apply each provider's revocation, deletion, cache, source-deletion, and deletion-confirmation deadlines, including derived records where required.
4. Keep provider approval, user-capacity, caching, attribution, branding, downstream-processor, and disclosure requirements aligned with production behavior.
5. Confirm the Junction agreement and source-provider flow-down terms for every enabled Junction route.
6. Route connected-source security incidents through provider-specific notice clocks as well as applicable regulatory procedures.
7. Re-disable an affected new-connection offer if its retained permission no longer covers the configured production path.
