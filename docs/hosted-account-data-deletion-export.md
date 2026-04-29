# Hosted account data deletion and export

Last verified: 2026-04-29

## Purpose

Murph hosted users need a real, backend-backed way to export account metadata and delete live account data from the Settings page before wider beta. The MVP workflow is intentionally conservative: it exports safe metadata and counts, never exports tokens or ciphertext, and requires an authenticated destructive request with two user confirmations before deletion starts.

## User-facing entry points

- `/settings` includes a **Data & privacy** section.
- **Export JSON** calls `GET /api/settings/privacy/export` and downloads a JSON document with account metadata, connected-provider status, per-store counts, and coverage notes.
- **Delete data** opens a two-step dialog. The first step explains the high-value stores covered. The second step requires the exact phrase `DELETE MY MURPH DATA` plus explicit acknowledgements that live deletion is irreversible and that providers, vendors, and backups have separate retention rules.

## Security model

The delete endpoint is intentionally stricter than a normal settings mutation.

1. `POST /api/settings/privacy/delete` requires an active Privy-backed hosted member session via `requireActivePrivyMemberAuth`.
2. The route enforces same-origin mutation protection with `assertHostedOnboardingMutationOrigin`.
3. The backend parses JSON through the hosted onboarding JSON helper instead of accepting form-encoded or ambiguous bodies.
4. `parseHostedAccountDeletionRequest` requires the exact confirmation phrase. Lowercase, extra spaces, or omitted acknowledgements fail with structured 400 errors.
5. Provider revocation and Cloudflare cleanup run before local database rows are deleted, so the workflow can still read the provider and runner identifiers needed for cleanup.
6. Prisma deletion happens in a single hosted onboarding transaction and explicitly deletes child tables before the hosted member row.

## Export contract

`buildHostedAccountDataExport` returns schema `murph.hosted-account-data-export.v1`.

The export includes:

- Hosted member timestamps, billing status, suspended state, and pending activation timezone.
- Privacy-preserving identity state, such as whether Privy, phone, or wallet identifiers are linked. It does not include encrypted phone, wallet, or Privy identifiers.
- Routing and email-authorization link booleans. It does not include encrypted Telegram, Linq, reply-alias, verified-email, or sender identifiers.
- Device connection metadata: provider, display name, status, and sync timestamps. It does not include provider access tokens, refresh tokens, external account IDs, or token ciphertext.
- Vault sync session metadata and payload-presence booleans. It does not include pairing-code hashes, agent-token hashes, source vault IDs, or encrypted vault payload ciphertext.
- Hosted workspace metadata and reference-presence booleans. It does not include R2 object keys or snapshot ciphertext.
- Per-store counts and the coverage matrix below.

## Deletion workflow

`deleteHostedAccountData` performs deletion in this order:

1. Load the hosted member and device connection identities.
2. Best-effort revoke wearable/device provider access with the existing device-sync provider `revokeAccess` hook, currently covering configured Oura, WHOOP, Garmin, and Strava connectors.
3. Best-effort call hosted execution control to delete Cloudflare Durable Object state and R2 user artifacts.
4. Delete Prisma-hosted account rows in a transaction.
5. Return schema `murph.hosted-account-data-deletion-result.v1` with deletion counts, provider revocation outcomes, Cloudflare cleanup status, and retention notes.

## Store coverage

| Store | Delete mode | Export mode | Notes |
| --- | --- | --- | --- |
| `prisma.hosted_member` | Live delete | Metadata/counts | Deletes the member row after explicit child cleanup. Prisma cascade remains a safety net. |
| `prisma.hosted_member_identity` | Live delete | Metadata/counts | Deletes Privy identity and encrypted contact hints. Export only reports linked/verified state and masked hints. |
| `prisma.hosted_member_routing` | Live delete | Metadata/counts | Deletes encrypted Linq, Telegram, and reply-alias routing bindings. |
| `prisma.hosted_member_email_authorization` | Live delete | Metadata/counts | Deletes verified-email and direct-public-sender authorization records. |
| `prisma.hosted_member_billing_ref` | Local reference delete | Metadata/counts | Deletes local encrypted Stripe references. Stripe retention remains separate. |
| `prisma.hosted_mailbox_item` | Live delete | Metadata/counts | Deletes mailbox envelopes, inline ciphertext refs, dedupe keys, and sequence data. |
| `prisma.hosted_mailbox_payload` | Live delete | Not exported secret | Deletes encrypted mailbox payload ciphertext. Export reports counts only. |
| `prisma.hosted_mailbox_lane_counter` | Live delete | Metadata/counts | Deletes per-lane counters so deleted users cannot resume old lanes. |
| `prisma.hosted_vault_sync_session` | Live delete | Metadata/counts | Deletes sync sessions, pairing-code hashes, and agent-token hashes. |
| `prisma.hosted_vault_sync_payload` | Live delete | Not exported secret | Deletes encrypted local-vault import payloads. Export reports counts only. |
| `prisma.hosted_workspace` | Live delete | Metadata/counts | Deletes workspace checkpoint refs, browser vault replica refs, wake state, and redacted status. |
| `prisma.hosted_runtime_log` | Live delete | Metadata/counts | Deletes member-scoped runtime logs and redacted runtime JSON. |
| `prisma.hosted_ai_usage` | Live delete | Metadata/counts | Deletes local AI usage rows. Already-submitted vendor metering may remain externally. |
| `prisma.hosted_linq_daily_state` | Live delete | Metadata/counts | Deletes Linq daily inbound/outbound quota counters. |
| `prisma.hosted_invite` | Live delete | Metadata/counts | Deletes invite codes and channel metadata owned by the member. |
| `prisma.device_connection` | Live delete | Metadata/counts | Revokes providers where possible, then deletes connection rows and encrypted token bundles. |
| `prisma.device_token_audit` | Live delete | Metadata/counts | Deletes token audit history. |
| `prisma.device_sync_signal` | Live delete | Metadata/counts | Deletes pre-existing wake/sync signals. Deletion-time provider revocation does not enqueue new disconnect or wake work. |
| `prisma.device_oauth_session` | Live delete | Metadata/counts | Deletes pending provider OAuth state. |
| `prisma.device_agent_session` | Live delete | Metadata/counts | Deletes local agent bearer-token hashes and agent session metadata. |
| `prisma.device_browser_assertion_nonce` | Live delete | Metadata/counts | Deletes outstanding browser assertion nonces. |
| `prisma.hosted_web_internal_request_nonce` | Live delete | Metadata/counts | Deletes per-user anti-replay nonces. |
| `prisma.device_webhook_trace` | Live delete | Metadata/counts | Deletes webhook traces for provider accounts linked to the member's device connections. |
| `cloudflare.runner_durable_object` | Best-effort delete | Documented only | Hosted execution control clears user runner SQL state and alarms when configured. |
| `cloudflare.r2_user_artifacts` | Best-effort delete | Documented only | Hosted execution control deletes opaque user bundle, artifact, browser vault replica, runner-secret, and root-key-envelope objects when derivation keys are available. |
| `providers.oura_whoop_garmin_strava` | Best-effort delete | Metadata/counts | Existing provider revocation hooks run before local token deletion. Provider-side retention remains provider-controlled. |
| `providers.linq_telegram_email_messages` | Local reference delete | Metadata/counts | Deletes Murph-hosted mailbox and routing records; external carrier, Telegram, Linq, and email-provider copies are outside this endpoint. |
| `providers.stripe_privy` | Documented retention | Documented only | Deletes local references only. Vendor account records need Stripe/Privy/legal workflows. |
| `backups` | Documented retention | Documented only | Live data is deleted immediately. Backup copies age out under infrastructure retention and must not be restored except under documented recovery controls. |

## Cloudflare runner and R2 cleanup

The Cloudflare hosted-control package now exposes `POST /internal/users/:userId/delete`. The worker route requires the same Vercel OIDC authorization and bound-user header checks as the existing hosted runner control routes.

The Durable Object deletion method:

- clears cached runner crypto state for the target user;
- reads the user root key before deleting its root-key envelope so opaque per-user prefixes can still be derived;
- attempts deletion for user-scoped bundle, artifact, browser vault replica, runner secrets, and root-key-envelope R2 keys when the R2 binding supports deletion/listing;
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
- rejection of lowercase, whitespace-mutated, or incomplete confirmation payloads;
- uniqueness and completeness of the store-coverage matrix for every high-value store listed above;
- non-empty notes plus valid deletion/export modes for each store.

Any future account data store should update `HOSTED_ACCOUNT_DATA_STORE_COVERAGE`, the deletion/export implementation, this document, and the coverage test in the same change.
