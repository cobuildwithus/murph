# Hosted account data deletion and vault export

Last verified: 2026-06-24

## Purpose

Murph hosted users need a real way to export useful private vault data and delete their account (and all their data) from the Settings page before wider beta. Both sensitive actions require a one-time, session-bound signature from the member's Privy embedded Ethereum wallet. Privy protects that wallet with passkey MFA and may reuse its verified MFA session for up to one hour. The primary user-facing export downloads the decrypted browser-vault replica JSON that powers dashboard pages. Deletion also requires an exact typed confirmation phrase and wipes the member's Stripe and Privy vendor accounts.

## User-facing entry points

- `/settings` includes a **Data & privacy** section.
- **Export vault** opens a confirmation dialog that requires a sensitive-data acknowledgement, creates a short-lived authorization challenge, signs it with the passkey-MFA-protected Privy wallet, then loads the current browser-vault replica through `/api/settings/vault-export/session` and downloads it as JSON in the browser.
- **Delete account** explains that deletion is permanent, requires the exact phrase `DELETE MY ACCOUNT`, and signs a distinct one-time authorization challenge before deletion begins. After success the Settings page shows a short confirmation and redirects home; the hosted session is revoked server-side.

## Security model

The export and delete paths are intentionally stricter than normal settings reads.

1. `POST /api/settings/sensitive-action-challenge` derives a binding from the authenticated member, action kind, and Murph app-session id. It stores only a SHA-256 hash of the random challenge token and expires the row after 15 minutes.
2. The browser signs the exact server-generated message with the canonical Privy embedded Ethereum wallet. Murph does not clear Privy's one-hour MFA verification cache; each action still requires a fresh one-time wallet signature.
3. The real export or deletion route fetches the current Privy user, requires passkey-only wallet MFA, recovers the signer locally, compares it with the canonical embedded wallet, and atomically deletes the matching challenge before any sensitive work begins.
4. Settings vault export uses the same encrypted browser-vault session machinery as dashboard reads through `POST /api/settings/vault-export/session`. It additionally requires the one-time authorization before reading workspace state or releasing an encrypted replica.
5. The Settings client decrypts the browser-vault replica in-browser and downloads the decrypted JSON. The decrypted vault payload never passes through a separate hosted metadata-export endpoint; the obsolete public `/api/settings/data-export` route was removed.
6. `POST /api/settings/privacy/delete` keeps authenticated privacy access for members without active billing, requires the exact typed phrase, and consumes its distinct `account.delete` authorization before suspending the member or starting provider cleanup.
7. All challenge and action routes enforce browser mutation-origin protection and bounded JSON request bodies.
8. A signature is bound to one member, one app session, one action, and one challenge. Replays, cross-action use, and cross-session use fail closed.
9. Provider revocation runs before local database deletion while local token references are still readable.
10. Prisma deletion happens in a single hosted onboarding transaction and explicitly deletes child tables before the hosted member row.
11. Account deletion revokes the current hosted app session and clears its browser cookie after the local delete succeeds.
12. Temporal workflow termination and Cloudflare runner/R2 cleanup run only after the Prisma transaction commits, so a database failure does not leave a still-present account with already-destroyed orchestration or runner state.
13. The Stripe subscription is canceled before the Prisma transaction and fails closed: if the cancel call fails, deletion aborts with a retryable error so a deleted account can never keep an active subscription billing it. Stripe customer deletion and Privy user deletion run best-effort after the local wipe and are reported in the deletion result.

## Export contract

The Settings **Export vault** workflow downloads the browser-vault replica schema `murph.browser-vault-replica`.

The export includes:

- Browser-safe private vault entities from the browser-vault policy families: allergy, assessment, condition, event, experiment, family, genetics, goal, journal, protocol, regimen, provider, sample, and workout format.
- Entity attributes, lookup ids, titles, tags, status, dates, links, and bounded body previews.
- Metric rows, metric selection rows, metric goal progress rows, source-health rows, weekly sample summaries, assistant summary highlights, timeline rows, and search rows.
- Browser-vault policy metadata, generated timestamp, data version, and source bundle hash already used by the browser-vault freshness contract.

The Settings vault export does not include:

- Raw local vault files or a full hosted workspace archive.
- OAuth access and refresh tokens.
- Token hashes.
- Hosted mailbox ciphertext or arbitrary decoded mailbox payload bodies.
- CSRF, browser assertion, internal request, and OAuth state nonce tables.
- Active invite codes.
- Hosted R2 object keys for workspace snapshots, browser-vault replicas, artifacts, runner secrets, or raw email.
- API key environment variable names, gateway tag JSON, AI base URLs, session IDs, turn IDs, and Stripe metering identifiers/errors.

## Deletion workflow

`deleteHostedAccountData` performs deletion in this order:

1. Load the hosted member, decrypted Stripe/Privy vendor account references, and device connection identities.
2. Revoke wearable/device provider access with the existing device-sync provider `revokeAccess` hook before local device rows are deleted. Junction-routed Garmin and other Junction sources are deregistered through Junction when configured; providers without a revocation hook remain local-reference deletion only.
3. Cancel the Stripe subscription fail-closed: a cancel failure or a missing Stripe client while a subscription reference exists aborts deletion with a structured error. An already-canceled or missing subscription counts as done.
4. Delete Kernel browser sessions, every Managed Auth connection for the member's profile, and the profile before deleting Prisma-hosted account rows in a transaction.
5. Best-effort terminate the per-user hosted Temporal runtime workflow with reason `account-deleted`.
6. Best-effort call hosted execution control to delete Cloudflare Durable Object state and R2 user artifacts.
7. Best-effort terminate the per-user hosted Temporal runtime workflow again after Cloudflare cleanup, so any sleeping workflow state that survived a concurrent wake attempt is neutralized.
8. Best-effort delete the Stripe customer and the Privy user, reporting each outcome (`completed`, `failed`, `skipped_no_record`, `skipped_not_configured`) in the deletion result. Failures are logged as sanitized `[hosted-privacy]` console errors with the member id and error code only; operators reconcile leftover vendor records manually from those log lines because the local vendor references are already deleted.
9. Return schema `murph.hosted-account-data-deletion-result.v2` with deletion counts, provider revocation outcomes, vendor account deletion outcomes, Cloudflare cleanup status, and retention notes.

## Store coverage

| Store | Delete mode | Export mode | Notes |
| --- | --- | --- | --- |
| `prisma.hosted_member` | Live delete | Metadata/counts | Deletes the member row after explicit child cleanup. Prisma cascade remains a safety net. |
| `prisma.hosted_web_session` | Live delete | Metadata/counts | Deletes active and revoked hashed app-session tokens. Export reports counts only and omits token hashes. |
| `prisma.hosted_sensitive_action_challenge` | Live delete | Not exported secret | Deletes short-lived hashed authorization challenges. Raw tokens, signatures, and wallet authorization material are never persisted or exported. |
| `prisma.hosted_member_identity` | Live delete | Confirmed data export | Deletes Privy identity and encrypted contact hints. Confirmed export includes decrypted user-facing phone, Privy, and wallet fields while omitting lookup keys and active phone-code attempt IDs. |
| `prisma.hosted_member_routing` | Live delete | Confirmed data export | Deletes encrypted Linq, Telegram, and reply-alias routing bindings. Confirmed export includes decrypted user-facing routing IDs while omitting lookup keys. |
| `prisma.hosted_member_email_authorization` | Live delete | Confirmed data export | Deletes verified-email and direct-public-sender authorization records. Confirmed export includes addresses when available while omitting lookup keys. |
| `prisma.hosted_member_billing_ref` | Local reference delete | Confirmed data export | Deletes local encrypted Stripe references. Confirmed export includes local Stripe customer/subscription references. The Stripe subscription and customer themselves are canceled/deleted by the vendor-account deletion step. |
| `prisma.hosted_mailbox_item` | Live delete | Metadata/counts | Deletes mailbox envelopes, inline ciphertext refs, dedupe keys, and sequence data. Export includes envelope metadata and payload presence/byte counts while omitting dedupe keys and payload refs. |
| `prisma.hosted_mailbox_payload` | Live delete | Not exported secret | Deletes encrypted mailbox payload ciphertext. Export reports payload presence and bytes while omitting ciphertext and arbitrary decoded payload JSON. |
| `prisma.hosted_mailbox_lane_counter` | Live delete | Metadata/counts | Deletes per-lane counters so deleted users cannot resume old lanes. |
| `prisma.hosted_workspace` | Live delete | Metadata/counts | Deletes workspace checkpoint refs, browser vault replica refs, wake state, and redacted status. |
| `prisma.hosted_runtime_log` | Live delete | Documented only | Deletes member-scoped runtime logs and redacted runtime JSON. Export omits runtime log rows and counts. |
| `prisma.hosted_user_crypto_envelope` | Live delete | Metadata/counts | Deletes signed domain root envelopes. Export reports counts only. |
| `prisma.hosted_user_crypto_audit` | Live delete | Metadata/counts | Deletes hosted crypto provisioning audit rows. Export reports counts only. |
| `prisma.hosted_ai_usage` | Live delete | Metadata/counts | Deletes local AI usage rows. Already-submitted vendor metering may remain externally. |
| `prisma.hosted_ai_usage_period` | Live delete | Metadata/counts | Deletes local allowance-period snapshots. Export includes period windows, allowance totals, and billing-state metadata while omitting internal reconciliation identifiers. |
| `prisma.hosted_product_feedback` | Live delete | Confirmed data export | Deletes assistant-captured product feedback rows. Confirmed export includes safe kind/summary metadata and optional published changelog item ids while omitting internal feedback ids. |
| `prisma.hosted_linq_daily_state` | Live delete | Metadata/counts | Deletes Linq daily inbound/outbound quota counters. |
| `prisma.hosted_invite` | Live delete | Metadata/counts | Deletes invite codes and channel metadata owned by the member. |
| `prisma.hosted_consent_event` | Live delete | Confirmed data export | Deletes member-scoped consent event history. Confirmed export includes event scope/source/action and document metadata. |
| `prisma.hosted_consent_grant` | Live delete | Confirmed data export | Deletes member-scoped consent grant state. Confirmed export includes grant scope/source/status and document metadata. |
| `prisma.device_connection` | Live delete | Metadata/counts | Revokes providers where possible, then deletes connection rows and encrypted token bundles. |
| `prisma.device_token_audit` | Live delete | Metadata/counts | Deletes token audit history. |
| `prisma.device_sync_signal` | Live delete | Metadata/counts | Deletes pre-existing wake/sync signals. Deletion-time provider revocation does not enqueue new disconnect or wake work. |
| `prisma.device_connect_intent` | Live delete | Metadata/counts | Deletes short-lived hosted device connect intents. Export reports safe metadata only and omits assertion/nonces and routing internals. |
| `prisma.device_oauth_session` | Live delete | Metadata/counts | Deletes pending provider OAuth state. |
| `prisma.device_agent_session` | Live delete | Metadata/counts | Deletes local agent bearer-token hashes and agent session metadata. |
| `prisma.device_browser_assertion_nonce` | Live delete | Metadata/counts | Deletes outstanding browser assertion nonces. |
| `prisma.hosted_web_internal_request_nonce` | Live delete | Metadata/counts | Deletes per-user anti-replay nonces. |
| `prisma.device_webhook_trace` | Live delete | Documented only | Deletes webhook traces for provider accounts linked to the member's device connections when linkage is available. User export omits trace rows and trace counts until the minimized webhook trace model has a safe user linkage. |
| `kernel.managed_auth_connections` | Live delete | Not exported secret | Deletes durable domain connections, saved credentials, and active login workflows before the member profile. Murph does not persist connection ids or credential values locally. |
| `cloudflare.runner_durable_object` | Best-effort delete | Documented only | Hosted execution control clears user runner SQL state and alarms when configured. |
| `cloudflare.r2_user_artifacts` | Best-effort delete | Documented only | Hosted execution control deletes opaque user bundle, artifact, browser vault replica, runner-secret, and raw-email objects when web-hosted domain root context is available. Root envelopes are canonical in web Postgres. |
| `temporal.per_user_runtime_workflow` | Best-effort delete | Documented only | Account deletion terminates the per-user hosted Temporal runtime workflow after the Prisma deletion commits and around Cloudflare cleanup, neutralizing sleeping wake flags and runtime-result wake state. |
| `providers.oura_whoop_strava` | Best-effort delete | Metadata/counts | Existing provider revocation hooks run before local token deletion. Provider-side retention remains provider-controlled. |
| `providers.linq_telegram_email_messages` | Local reference delete | Metadata/counts | Deletes Murph-hosted mailbox and routing records; external carrier, Telegram, Linq, and email-provider copies are outside this endpoint. |
| `providers.stripe_privy` | Best-effort delete | Documented only | Cancels the Stripe subscription before local deletion (fail-closed), then deletes the Stripe customer and Privy user best-effort after the local wipe. Outcomes are reported in the deletion result. |
| `backups` | Documented retention | Documented only | Live data is deleted immediately. Backup copies age out under infrastructure retention and must not be restored except under documented recovery controls. |

## Cloudflare runner and R2 cleanup

The Cloudflare hosted-control package now exposes `POST /internal/users/:userId/account-data/delete`. The worker route requires the same Vercel OIDC authorization and bound-user header checks as the existing hosted runner control routes and enforces a 4 KiB JSON body limit.

The Durable Object deletion method:

- clears cached runner crypto state for the target user;
- preflights the Durable Object bound user before deleting R2 objects;
- reads web-hosted runtime and ingress root context so opaque per-user prefixes can be derived;
- attempts deletion for user-scoped bundle, artifact, browser vault replica, runner-secret, and raw-email R2 keys when the R2 binding supports deletion/listing;
- leaves hosted domain root envelopes in web-owned Postgres for the web deletion transaction;
- deletes runner SQL state for that user only and rejects deletion if the Durable Object is bound to a different user;
- clears the Durable Object alarm.
- best-effort destroys the warm runner container for the deleted user so live container state does not linger until normal container expiry.

Container workspace artifacts are covered to the extent they are persisted through the existing R2/runner-state contract. Ephemeral live container filesystem state is not separately addressable by this MVP because the existing worker/container contract does not expose a per-user container filesystem wipe primitive.

## Temporal workflow cleanup

Hosted deletion treats the per-user Temporal runtime workflow as orchestration state, not product truth. After Prisma account rows are deleted successfully, the deletion service best-effort terminates the workflow with reason `account-deleted` before Cloudflare cleanup and repeats the same bounded best-effort termination afterward. A missing or already-finished workflow is considered cleaned up, and timeout or transport failures are logged as sanitized best-effort cleanup errors without blocking Cloudflare cleanup.

The hosted runtime reconciliation-facts endpoint also fails closed for stale workflow wakeups: if the member is missing, suspended, or not active, facts return `blocked` with reason `user_not_active` and no retry. If an active member has durable work pending but no hosted workspace row, facts return `blocked` with reason `hosted_runtime_not_configured` and no retry. Those guards prevent a sleeping workflow from turning stale mailbox, manual, or workspace wake state into a new Cloudflare execution after deletion or deactivation.

## External providers, vendors, and backups

Deletion cannot guarantee immediate erasure in systems Murph does not control. The deletion/export result therefore always carries retention notes for:

- Linq, Telegram, carrier, and email-provider copies of messages or routing events already delivered to those external systems;
- infrastructure backups and restore media that age out under documented retention.

Stripe and Privy vendor accounts are actively deleted by the deletion workflow itself: the subscription is canceled fail-closed before the local wipe, and the customer and Privy user are deleted best-effort afterward. Stripe retains records it is legally required to keep (for example invoices) under its own documented processes after the customer object is deleted.

## Tests

`apps/web/test/hosted-account-data-service.test.ts` covers:

- the exact destructive phrase requirement;
- the exact data-export phrase and sensitive-download acknowledgement;
- rejection of lowercase, whitespace-mutated, or missing confirmation payloads;
- uniqueness and completeness of the store-coverage matrix for every high-value store listed above;
- non-empty notes plus valid deletion/export modes for each store.
- high-value data export contents, bounded/truncated export metadata, omitted mailbox payload bodies, omitted runtime logs, and redaction of lookup keys, token hashes, invite codes, API key environment names, and workspace object refs.
- deletion ordering that keeps Cloudflare cleanup after Prisma commit and skips Cloudflare cleanup when the transaction fails.
- Temporal workflow termination ordering after Prisma commit, plus hosted reconciliation-facts blocking for deleted, inactive, or unconfigured users.
- vendor account deletion: Stripe subscription cancel before the local wipe (and abort on failure), Stripe customer and Privy user deletion after it, already-canceled/missing-record skips, not-configured skips, and best-effort failure reporting.

Any future account data store should update `HOSTED_ACCOUNT_DATA_STORE_COVERAGE`, the deletion/export implementation, this document, and the coverage test in the same change.
