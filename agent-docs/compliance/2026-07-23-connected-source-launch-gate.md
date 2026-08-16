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
- Member-owned provider setup is authorized explicitly from `/connect` and uses an
  exact setup-owned authenticated browser run. The assistant may navigate the
  provider dashboard, fill and submit ordinary private-application metadata, and
  recover from visible provider errors. It must never ask for, read, transcribe,
  or preserve credential values.
- Credential capture is deterministic and provider-registered: trusted code loads
  the exact credentials URL, verifies origin and path, optionally reveals the
  secret, requires one visible client-ID element and one visible client-secret
  element, seals both values through the encrypted provider-application owner,
  scrubs browser-side values, and returns no credentials.
- External deletion is authorized only by exact comparison of the registered
  on-page client ID with the sealed client ID. A clean page with no client-ID
  element is already absent; any mismatch, ambiguity, authentication interruption,
  or uncertain completion fails closed. Account deletion cannot pass its
  pre-suspension gate until the exact-bound connection, encrypted application
  binding, and resumable setup-owned browser work are gone.
- Continue and setup-owned handoff Done persist one exact typed continuation in
  the existing system mailbox before the droppable runtime wake. Duplicate actions
  converge, and mailbox handoff recovery resumes work after a lost wake without a
  new member message or any credential material in assistant context.
- OAuth uses the exact application id/revision and the read-only `activity:read`
  request. Connection rows are authoritative after callback. Initial backfill and
  scheduled polling remain enabled; member-owned Strava webhooks are not enabled.
- Strava disconnect uses `POST /oauth/revoke` with exact application Basic
  authentication and the access token in the form body. Credential values and
  authorization headers are excluded from diagnostics.
- Account deletion requires the member to disconnect the exact connection and
  remove the exact client-ID-matched provider application through the ordinary authenticated `/connect` flow. The member-lock transaction checks every active
  setup, application, and exact setup-owned run immediately before suspension;
  application save rejects the suspended member. Post-suspension cleanup
  is local-only and fails closed if that preflight is invalidated, so no provider
  browser handoff depends on suspended-member access.
- Successful private-application deletion keeps its setup active while the exact
  browser run is being released, then clears the run and active slot together so
  a later connect or reconnect starts from one fresh pending setup.
- Hermetic route, service, tool, prompt, browser-boundary, OAuth/token, device-sync,
  and concurrency tests cover setup, handoff resume, sealing, exact binding,
  backfill/polling, reconnect, disconnect, cancellation, and deletion without a
  checked-in provider-specific browser program.

### Remaining live launch proof

The repository proof above is not evidence that the production Strava dashboard,
subscription state, authorization UI, or account policies have remained unchanged.
Before enabling this path broadly, the release owner must complete and record a
live, non-secret validation of:

1. production Kernel/Managed Auth handoff through sign-in, MFA/CAPTCHA when
   presented, and the developer-subscription prerequisite;
2. ordinary application create and existing-app recovery using the deployed callback, plus registered-selector credential capture,
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
