# Hosted account data deletion and export

Last verified: 2026-04-30

## Purpose

Murph hosted users need a real, backend-backed way to export account data and delete live account data from the Settings page before wider beta. The MVP workflow is intentionally conservative: the export requires an authenticated confirmed POST before returning a no-store JSON attachment, and deletion requires an authenticated destructive request with two user confirmations before deletion starts.

## User-facing entry points

- `/settings` includes a **Data & privacy** section.
- **Export data** opens a confirmation dialog that requires an acknowledgement checkbox plus the exact phrase `EXPORT MY DATA`, then calls `POST /api/settings/data-export` and downloads a JSON attachment.
- **Delete data** opens a two-step dialog. The first step explains the high-value stores covered. The second step requires the exact phrase `DELETE MY MURPH DATA` plus explicit acknowledgements that live deletion is irreversible and that providers, vendors, and backups have separate retention rules.

## Security model

The export and delete endpoints are intentionally stricter than normal settings reads.

1. `POST /api/settings/data-export` and `POST /api/settings/privacy/delete` require an authenticated Privy-backed hosted member session via `requirePrivyMemberAuth`, including members who need privacy access after losing active billing state.
2. Both routes enforce same-origin mutation protection with `assertHostedOnboardingMutationOrigin`.
3. Both routes parse JSON through the hosted onboarding JSON helper with a 4 KiB body limit instead of accepting form-encoded, ambiguous, or oversized bodies.
4. `parseHostedDataExportRequest` requires the exact `EXPORT MY DATA` phrase plus sensitive-download acknowledgement. Lowercase, extra spaces, or omitted acknowledgement fail with structured 400 errors.
5. `parseHostedAccountDeletionRequest` requires the exact deletion confirmation phrase. Lowercase, extra spaces, or omitted acknowledgements fail with structured 400 errors.
6. The data export response is a JSON attachment with `private, no-store, no-cache` caching headers, same-origin resource policy, no referrer policy, and content-type sniffing disabled.
7. Provider revocation runs before local database deletion while local token references are still readable.
8. Prisma deletion happens in a single hosted onboarding transaction and explicitly deletes child tables before the hosted member row.
9. Cloudflare runner/R2 cleanup runs only after the Prisma transaction commits, so a database failure does not leave a still-present account with already-destroyed runner state.

## Export contract

The user-facing export route calls `buildHostedDataExport`, which returns schema `murph.hosted-data-export.v1`.

The export includes:

- Hosted member core fields plus decrypted user-facing identity, routing, billing reference, and email authorization fields when available.
- Mailbox items with envelope metadata, payload byte counts, and payload presence flags, plus lane counters and Linq daily state.
- Hosted invites without active invite codes.
- Consent events and grants.
- Device connection, token audit, sync signal, and agent session metadata with internal identifiers and provider metadata replaced by presence flags.
- Hosted workspace metadata and vault sync session metadata with object keys, manifest hashes, and source vault IDs replaced by presence flags.
- AI usage rows with environment, gateway, session, turn, and Stripe metering internals replaced by presence flags.
- Hosted runtime diagnostics with diagnostic JSON and outbox intent refs omitted.
- Per-store row limits and truncation metadata. Each multi-row export query returns at most 250 rows for this MVP.

The export explicitly omits:

- OAuth access and refresh tokens.
- Token hashes.
- Privy, Stripe, contact, Telegram, device, and other blind-index lookup keys.
- CSRF, browser assertion, internal request, and OAuth state nonce tables.
- Active invite codes.
- Active signup phone-code attempt IDs.
- Internal row, correlation, session, trace, and route identifiers when a presence flag is sufficient.
- Arbitrary decoded mailbox payload bodies.
- Vault sync pairing codes, agent tokens, and encrypted vault payload blobs.
- Hosted workspace snapshot/browser-replica object keys and bundle hashes.
- API key environment variable names, gateway tag JSON, AI base URLs, session IDs, turn IDs, and Stripe metering identifiers/errors.

## Deletion workflow

`deleteHostedAccountData` performs deletion in this order:

1. Load the hosted member and device connection identities.
2. Best-effort revoke wearable/device provider access with the existing device-sync provider `revokeAccess` hook, currently covering configured Oura, WHOOP, Garmin, and Strava connectors.
3. Delete Prisma-hosted account rows in a transaction.
4. Best-effort call hosted execution control to delete Cloudflare Durable Object state and R2 user artifacts.
5. Return schema `murph.hosted-account-data-deletion-result.v1` with deletion counts, provider revocation outcomes, Cloudflare cleanup status, and retention notes.

## Store coverage

| Store | Delete mode | Export mode | Notes |
| --- | --- | --- | --- |
| `prisma.hosted_member` | Live delete | Metadata/counts | Deletes the member row after explicit child cleanup. Prisma cascade remains a safety net. |
| `prisma.hosted_member_identity` | Live delete | Confirmed data export | Deletes Privy identity and encrypted contact hints. Confirmed export includes decrypted user-facing phone, Privy, and wallet fields while omitting lookup keys and active phone-code attempt IDs. |
| `prisma.hosted_member_routing` | Live delete | Confirmed data export | Deletes encrypted Linq, Telegram, and reply-alias routing bindings. Confirmed export includes decrypted user-facing routing IDs while omitting lookup keys. |
| `prisma.hosted_member_email_authorization` | Live delete | Confirmed data export | Deletes verified-email and direct-public-sender authorization records. Confirmed export includes addresses when available while omitting lookup keys. |
| `prisma.hosted_member_billing_ref` | Local reference delete | Confirmed data export | Deletes local encrypted Stripe references. Confirmed export includes local Stripe customer/subscription references. Stripe retention remains separate. |
| `prisma.hosted_mailbox_item` | Live delete | Metadata/counts | Deletes mailbox envelopes, inline ciphertext refs, dedupe keys, and sequence data. Export includes envelope metadata and payload presence/byte counts while omitting dedupe keys and payload refs. |
| `prisma.hosted_mailbox_payload` | Live delete | Not exported secret | Deletes encrypted mailbox payload ciphertext. Export reports payload presence and bytes while omitting ciphertext and arbitrary decoded payload JSON. |
| `prisma.hosted_mailbox_lane_counter` | Live delete | Metadata/counts | Deletes per-lane counters so deleted users cannot resume old lanes. |
| `prisma.hosted_vault_sync_session` | Live delete | Metadata/counts | Deletes sync sessions, pairing-code hashes, and agent-token hashes. |
| `prisma.hosted_vault_sync_payload` | Live delete | Not exported secret | Deletes encrypted local-vault import payloads. Export reports counts only. |
| `prisma.hosted_workspace` | Live delete | Metadata/counts | Deletes workspace checkpoint refs, browser vault replica refs, wake state, and redacted status. |
| `prisma.hosted_runtime_log` | Live delete | Metadata/counts | Deletes member-scoped runtime logs and redacted runtime JSON. |
| `prisma.hosted_ai_usage` | Live delete | Metadata/counts | Deletes local AI usage rows. Already-submitted vendor metering may remain externally. |
| `prisma.hosted_linq_daily_state` | Live delete | Metadata/counts | Deletes Linq daily inbound/outbound quota counters. |
| `prisma.hosted_invite` | Live delete | Metadata/counts | Deletes invite codes and channel metadata owned by the member. |
| `prisma.hosted_consent_event` | Live delete | Confirmed data export | Deletes member-scoped consent event history. Confirmed export includes event scope/source/action and document metadata. |
| `prisma.hosted_consent_grant` | Live delete | Confirmed data export | Deletes member-scoped consent grant state. Confirmed export includes grant scope/source/status and document metadata. |
| `prisma.device_connection` | Live delete | Metadata/counts | Revokes providers where possible, then deletes connection rows and encrypted token bundles. |
| `prisma.device_token_audit` | Live delete | Metadata/counts | Deletes token audit history. |
| `prisma.device_sync_signal` | Live delete | Metadata/counts | Deletes pre-existing wake/sync signals. Deletion-time provider revocation does not enqueue new disconnect or wake work. |
| `prisma.device_oauth_session` | Live delete | Metadata/counts | Deletes pending provider OAuth state. |
| `prisma.device_agent_session` | Live delete | Metadata/counts | Deletes local agent bearer-token hashes and agent session metadata. |
| `prisma.device_browser_assertion_nonce` | Live delete | Metadata/counts | Deletes outstanding browser assertion nonces. |
| `prisma.hosted_web_internal_request_nonce` | Live delete | Metadata/counts | Deletes per-user anti-replay nonces. |
| `prisma.device_webhook_trace` | Live delete | Documented only | Deletes webhook traces for provider accounts linked to the member's device connections when linkage is available. User export omits trace rows and trace counts until the minimized webhook trace model has a safe user linkage. |
| `cloudflare.runner_durable_object` | Best-effort delete | Documented only | Hosted execution control clears user runner SQL state and alarms when configured. |
| `cloudflare.r2_user_artifacts` | Best-effort delete | Documented only | Hosted execution control deletes opaque user bundle, artifact, browser vault replica, runner-secret, and root-key-envelope objects when derivation keys are available. |
| `providers.oura_whoop_garmin_strava` | Best-effort delete | Metadata/counts | Existing provider revocation hooks run before local token deletion. Provider-side retention remains provider-controlled. |
| `providers.linq_telegram_email_messages` | Local reference delete | Metadata/counts | Deletes Murph-hosted mailbox and routing records; external carrier, Telegram, Linq, and email-provider copies are outside this endpoint. |
| `providers.stripe_privy` | Documented retention | Documented only | Deletes local references only. Vendor account records need Stripe/Privy/legal workflows. |
| `backups` | Documented retention | Documented only | Live data is deleted immediately. Backup copies age out under infrastructure retention and must not be restored except under documented recovery controls. |

## Cloudflare runner and R2 cleanup

The Cloudflare hosted-control package now exposes `POST /internal/users/:userId/account-data/delete`. The worker route requires the same Vercel OIDC authorization and bound-user header checks as the existing hosted runner control routes and enforces a 4 KiB JSON body limit.

The Durable Object deletion method:

- clears cached runner crypto state for the target user;
- preflights the Durable Object bound user before deleting R2 objects;
- reads the user root key before deleting any root-key envelope so opaque per-user prefixes can still be derived;
- attempts deletion for user-scoped bundle, artifact, browser vault replica, and runner-secret R2 keys when the R2 binding supports deletion/listing;
- deletes the root-key envelope only after user-scoped R2 cleanup has been attempted with a usable crypto context;
- deletes runner SQL state for that user only and rejects deletion if the Durable Object is bound to a different user;
- clears the Durable Object alarm.
- best-effort destroys the warm runner container for the deleted user so live container state does not linger until normal container expiry.

Container workspace artifacts are covered to the extent they are persisted through the existing R2/runner-state contract. Ephemeral live container filesystem state is not separately addressable by this MVP because the existing worker/container contract does not expose a per-user container filesystem wipe primitive.

## External providers, vendors, and backups

Deletion cannot guarantee immediate erasure in systems Murph does not control. The deletion/export result therefore always carries retention notes for:

- Oura, WHOOP, Garmin, Strava, and other provider-side data after revocation;
- Linq, Telegram, carrier, and email-provider copies of messages or routing events;
- Stripe billing/accounting records;
- Privy identity/session records;
- infrastructure backups and restore media.

The MVP deletes Murph live stores and local references. Provider/vendor erasure workflows should be documented and wired separately once those APIs/contracts are available.

## Tests

`apps/web/test/hosted-account-data-service.test.ts` covers:

- the exact destructive phrase and second-confirmation acknowledgements;
- the exact data-export phrase and sensitive-download acknowledgement;
- rejection of lowercase, whitespace-mutated, or incomplete confirmation payloads;
- uniqueness and completeness of the store-coverage matrix for every high-value store listed above;
- non-empty notes plus valid deletion/export modes for each store.
- high-value data export contents, bounded/truncated export metadata, omitted mailbox payload bodies, and redaction of lookup keys, token hashes, invite codes, API key environment names, and encrypted vault payloads.
- deletion ordering that keeps Cloudflare cleanup after Prisma commit and skips Cloudflare cleanup when the transaction fails.

Any future account data store should update `HOSTED_ACCOUNT_DATA_STORE_COVERAGE`, the deletion/export implementation, this document, and the coverage test in the same change.
