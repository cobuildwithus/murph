# Hosted account data deletion and vault export

Last verified: 2026-08-09

## Purpose

Murph hosted users need a real way to export useful private vault data and delete their account (and all their data) from the Settings page before wider beta. Both sensitive actions require a one-time, session-bound signature from the member's Privy embedded Ethereum wallet. Privy protects that wallet with passkey MFA and may reuse its verified MFA session for up to one hour. The primary user-facing export downloads the decrypted browser-vault replica JSON that powers dashboard pages. Deletion also requires an exact typed confirmation phrase and wipes the member's Stripe and Privy vendor accounts.

## User-facing entry points

- `/settings` includes a **Data & privacy** section.
- **Export vault** opens a confirmation dialog that requires a sensitive-data acknowledgement, creates a short-lived authorization challenge, signs it with the passkey-MFA-protected Privy wallet, then loads the current browser-vault replica through `/api/settings/vault-export/session` and downloads it as JSON in the browser.
- **Delete account** explains that deletion is permanent, requires the exact phrase `DELETE MY ACCOUNT`, and signs a distinct one-time authorization challenge before deletion begins. After success the Settings page shows a short confirmation and redirects home; the hosted session is revoked server-side.

## Security model

Account deletion is intentionally stricter than normal settings reads. Vault export is an explicit user-intent confirmation gesture for the bulk JSON download, not a stricter session-trust upgrade: an active hosted session can already read the same encrypted browser-vault replica through `POST /api/browser-vault/session` to render the dashboard, so the MFA-bound signature on export protects against confused-deputy and forced-action paths (browser extensions, embedded iframes, accidental UI activation) rather than against an attacker who already has the live session cookie. Account deletion is destructive and the MFA gate is a real authority requirement: a signature is required before any vendor cancel, Prisma delete, or vendor-account cleanup runs.

1. `POST /api/settings/sensitive-action-challenge` derives a binding from the authenticated member, action kind, and Murph app-session id. It stores only a SHA-256 hash of the random challenge token and expires the row after 15 minutes.
2. The browser signs the exact server-generated message with the canonical Privy embedded Ethereum wallet. Murph does not clear Privy's one-hour MFA verification cache; each action still requires a fresh one-time wallet signature.
3. The real export or deletion route fetches the current Privy user, requires passkey-only wallet MFA, recovers the signer locally, compares it with the canonical embedded wallet, and atomically deletes the matching challenge before any sensitive work begins.
4. Settings vault export uses the same encrypted browser-vault replica plumbing as dashboard reads but runs through a self-contained `POST /api/settings/vault-export/session` route. The route verifies the MFA-bound signature first, then re-reads workspace state and pending device-sync state, compares the current workspace source-state hash against the replica's `sourceBundleHash`, fetches the encrypted retained replica from the hosted execution control client, and only then atomically consumes the one-time challenge. An existing retained replica remains exportable while source changes or device imports are pending; the response marks that state so the client explains that recent changes may be absent, and active processing receives a best-effort refresh signal. A missing workspace or replica returns a retryable error without consuming the challenge. Withdrawn consent never wakes processing and can export only the latest replica already retained.
5. The Settings client decrypts the browser-vault replica in-browser and downloads the decrypted JSON. The decrypted vault payload never passes through a separate hosted metadata-export endpoint; the obsolete public `/api/settings/data-export` route was removed.
6. `POST /api/settings/privacy/delete` keeps authenticated privacy access for members without active billing, requires the exact typed phrase, and consumes its distinct `account.delete` authorization before suspending the member or starting provider cleanup.
7. All challenge and action routes enforce browser mutation-origin protection and bounded JSON request bodies.
8. A signature is bound to one member, one app session, one action, and one challenge. Replays, cross-action use, and cross-session use fail closed.
9. The account-deletion owner commits the member suspension fence before any
   provider revocation, provider-dashboard automation, decryption, or Retell
   call-object deletion. External cleanup then runs while local retry identifiers
   and token/application references remain readable. Retell cleanup fails closed
   on ambiguous provider or local-write outcomes.
   For a member-owned provider, the exact bound connection is revoked through the
   exact stored application revision first. The existing setup-owned browser then
   loads the registered credentials page. Trusted code reads the client ID only
   through the provider-registered selector and compares it exactly with the sealed
   client ID before any delete or confirmation click. A cleanly loaded page with no
   client-ID element is already absent. Redirects, mismatches, duplicate or hidden
   identifiers, partial pages, sign-in/MFA/CAPTCHA interruptions, and uncertain
   post-delete state abort local deletion for authenticated retry. Unrelated
   provider applications are preserved and are never adopted, modified, or
   deleted. Only after external cleanup succeeds are setup rows, encrypted
   application rows, browser runs, Managed Auth artifacts, and the Kernel profile
   deleted by their existing owners.
10. Prisma deletion happens in a single hosted onboarding transaction and explicitly deletes child tables before the hosted member row. That same transaction first inserts a foreign-key-free cleanup receipt whose minimal vendor/runtime identifier payload is KMS-encrypted with receipt- and environment-bound authenticated data.
11. Account deletion revokes the current hosted app session and clears its browser cookie after the local delete succeeds.
12. The per-user Temporal runtime workflow is terminated best-effort before deletion starts, again after the Prisma transaction commits, and again after Cloudflare runner/R2 cleanup, so live runtime writers are stopped before local rows are removed and stale wake state is neutralized after cleanup.
13. The Stripe subscription is canceled before the Prisma transaction and fails closed: if the cancel call fails, deletion aborts with a retryable error so a deleted account can never keep an active subscription billing it. Stripe customer, Privy user, Cloudflare runner-state/R2, and isolated runtime-log deletion run immediately after the local wipe and remain owned by the encrypted cleanup receipt until every target confirms completion.

## Export contract

The Settings **Export vault** workflow downloads the browser-vault replica schema `murph.browser-vault-replica`.

The export includes:

- Browser-safe private vault entities from the browser-vault policy families: allergy, assessment, condition, event, experiment, family, genetics, goal, journal, protocol, regimen, provider, sample, and workout format.
- Entity attributes, lookup ids, titles, tags, status, dates, links, and bounded body previews.
- Metric rows, metric selection rows, metric goal progress rows, source-health rows, weekly sample summaries, assistant summary highlights, timeline rows, and search rows.
- All-history lab-result rows for each measured analyte, including dated numeric or qualitative results, original and normalized units, comparator, flag, reference-range context, and safe lab and source labels.
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
- Usage-credit Checkout URLs, Stripe payment identifiers, semantic source keys,
  source usage references, or per-grant allocation history.

## Deletion workflow

`deleteHostedAccountData` performs deletion in this order:

1. Load the hosted member, decrypted Stripe/Privy vendor account references, and device connection identities.
2. Suspend the hosted member for account deletion, then best-effort terminate the per-user hosted Temporal runtime workflow with reason `account-deleted` before provider revocation, billing cancellation, or local row deletion starts.
3. Process one bounded Retell cleanup batch containing every durable provider call id, including terminal calls. Active calls are stopped before their provider objects are deleted. A confirmed deletion or confirmed absence clears the local provider id; any ambiguous provider or local-write failure retains the row and id for retry and aborts account deletion. Unbound active reservations are reconciled by their Murph call metadata, and the final Prisma transaction rechecks that no provider id or active reservation remains.
4. Revoke wearable/device provider access with the existing device-sync provider `revokeAccess` hook before local device rows are deleted. Junction-routed Garmin and other Junction sources are deregistered through Junction when configured; providers without a revocation hook remain local-reference deletion only.
5. Cancel the Stripe subscription fail-closed: a cancel failure or a missing Stripe client while a subscription reference exists aborts deletion with a structured error. An already-canceled or missing subscription counts as done.
6. Cancel any Family plan Stripe subscriptions owned by the member before local Family group rows are removed. A family cancel failure also aborts deletion fail-closed.
7. Prepare an encrypted, foreign-key-free external-cleanup receipt before suspension. Delete Kernel browser sessions, every Managed Auth connection for the member's profile, and the profile before deleting Prisma-hosted account rows. Inside the canonical deletion transaction, recheck the complete runtime-member set, insert that receipt, then delete usage-credit ledger entries before their purchase rows and delete both before the hosted member row. If receipt preparation, runtime-set proof, or insertion fails, canonical account deletion does not commit.
8. Best-effort terminate the per-user hosted Temporal runtime workflow again after the Prisma transaction commits.
9. Immediately attempt the receipt-owned Cloudflare Durable Object/R2, isolated runtime-log, Stripe-customer, and Privy-user cleanup. Persist completion independently per target. Each target shares the five-second response-path budget plus a small receipt-settlement margin. Unconfigured, partial, timed-out, and failed targets remain pending.
10. Best-effort terminate the per-user hosted Temporal runtime workflow again after Cloudflare cleanup, so any sleeping workflow state that survived a concurrent wake attempt is neutralized.
11. The existing hourly retention sweep claims due receipts with a bounded lease and retries unfinished targets with capped exponential backoff, a fifteen-second target budget, and bounded four-receipt concurrency. A confirmed missing vendor object or absent Durable Object state is idempotent success. Completed targets are not retried, and the receipt is erased only after all targets converge.
12. Return schema `murph.hosted-account-data-deletion-result.v2` with deletion counts, provider revocation outcomes, vendor account deletion outcomes, Cloudflare cleanup status, `cleanupPending`, and retention notes. Settings shows a pending-cleanup state until that field is false.

## Store coverage

| Store | Delete mode | Export mode | Notes |
| --- | --- | --- | --- |
| `prisma.hosted_member` | Live delete | Metadata/counts | Deletes the member row after explicit child cleanup. Prisma cascade remains a safety net. |
| `prisma.hosted_web_session` | Live delete | Metadata/counts | Deletes active and revoked claim-bound app-session authenticators. Export reports counts only and omits session authenticators. |
| `prisma.hosted_sensitive_action_challenge` | Live delete | Not exported secret | Deletes hashed authorization challenges and durable Assistant approval decisions stored in the same member-scoped table. Raw tokens, signatures, action hashes, and wallet authorization material are never exported. |
| `prisma.hosted_member_identity` | Live delete | Confirmed data export | Deletes Privy identity and encrypted contact hints. Confirmed export includes decrypted user-facing phone, Privy, and wallet fields while omitting lookup keys and active phone-code attempt IDs. |
| `prisma.hosted_address_book_projection` | Live delete | Metadata/counts | Deletes the member's opt-in projection revision and enabled state before the member row. Export reports metadata/counts only. |
| `prisma.hosted_address_book_contact` | Live delete | Not exported secret | Deletes member-scoped phone tokens and encrypted advisory labels before the projection, preventing subsequent advisory lookup. Export never includes tokens, ciphertext, projected names, or third-party phone values. Labels already emitted into model/provider content cannot be recalled. |
| `prisma.hosted_member_routing` | Live delete | Confirmed data export | Deletes encrypted Linq, Telegram, and reply-alias routing bindings. Confirmed export includes decrypted user-facing routing IDs while omitting lookup keys. |
| `prisma.hosted_member_email_authorization` | Live delete | Confirmed data export | Deletes verified-email and direct-public-sender authorization records. Confirmed export includes addresses when available while omitting lookup keys. |
| `prisma.hosted_member_billing_ref` | Local reference delete | Confirmed data export | Deletes local encrypted Stripe references. Confirmed export includes local Stripe customer/subscription references. The Stripe subscription and customer themselves are canceled/deleted by the vendor-account deletion step. |
| `prisma.hosted_account_deletion_cleanup` | Receipt delete after external convergence | Not exported secret | Foreign-key-free retry owner created atomically before canonical member deletion. Stores only a KMS-encrypted minimal identifier payload, per-target completion, bounded lease, and retry metadata; the hourly retention sweep deletes it after isolated runtime-log, Cloudflare, Stripe-customer, and Privy cleanup all converge. |
| `prisma.hosted_account_group` | Live delete | Metadata/counts | Deletes Family plan groups owned by the member. Export reports counts only and never exposes other members' private account data. |
| `prisma.hosted_account_group_membership` | Live delete | Metadata/counts | Deletes the member's Family memberships and memberships in groups they own. Export reports counts only. |
| `prisma.hosted_account_group_invite` | Live delete | Metadata/counts | Deletes Family invitations sent, accepted, or owned through the member's Family group. Export omits invite codes and private target contact values. |
| `prisma.hosted_account_group_billing_ref` | Local reference delete | Metadata/counts | Deletes local Family Stripe references for groups owned by the member after fail-closed Family subscription cancellation. |
| `prisma.hosted_mailbox_item` | Live delete | Metadata/counts | Deletes mailbox envelopes, inline ciphertext refs, dedupe keys, and sequence data. Export includes envelope metadata and payload presence/byte counts while omitting dedupe keys and payload refs. |
| `prisma.hosted_mailbox_payload` | Live delete | Not exported secret | Deletes encrypted mailbox payload ciphertext. Export reports payload presence and bytes while omitting ciphertext and arbitrary decoded payload JSON. |
| `prisma.hosted_mailbox_lane_counter` | Live delete | Metadata/counts | Deletes per-lane counters so deleted users cannot resume old lanes. |
| `prisma.hosted_workspace` | Live delete | Metadata/counts | Deletes workspace checkpoint refs, browser vault replica refs, wake state, and redacted status. |
| `prisma.hosted_phone_call` | Provider delete, then live delete | Metadata/counts | Stops active Retell calls and deletes every known Retell provider object before clearing the local provider id and deleting phone-call rows plus encrypted private briefs/results. The row and provider id remain retry ownership on ambiguous cleanup. Export reports counts only and omits private content and ciphertext. |
| `postgres.hosted_runtime_log` | Receipt-owned retry delete | Documented only | Deletes isolated redacted runtime diagnostics under the same advisory lock used by append. The cleanup receipt retries failures after canonical member deletion; append rechecks primary suspension or existence after acquiring the lock, so late drains cannot recreate rows. |
| `prisma.hosted_user_crypto_envelope` | Live delete | Metadata/counts | Deletes signed domain root envelopes. Export reports counts only. |
| `prisma.hosted_user_crypto_audit` | Live delete | Metadata/counts | Deletes hosted crypto provisioning audit rows. Export reports counts only. |
| `prisma.hosted_ai_usage` | Live delete | Metadata/counts | Deletes local AI usage rows. Already-submitted vendor metering may remain externally. |
| `prisma.hosted_ai_usage_period` | Live delete | Metadata/counts | Deletes local allowance-period snapshots. Export includes period windows, allowance totals, and billing-state metadata while omitting internal reconciliation identifiers. |
| `prisma.hosted_usage_credit_entry` | Live delete | Not included in vault export | Deletes append-only usage-credit ledger rows before purchase and member rows. The deletion result reports row counts; browser-vault export omits semantic source keys, source usage references, and per-grant allocation history. |
| `prisma.hosted_usage_credit_purchase` | Live delete | Not included in vault export | Deletes local purchase state and encrypted Stripe references after its ledger entries. The deletion result reports row counts; browser-vault export omits Checkout URLs and payment identifiers. Stripe retains legally required payment records under its own processes. |
| `prisma.hosted_product_feedback` | Live delete | Confirmed data export | Deletes and exports only explicitly member-linked product feedback rows. Ordinary assistant-captured feedback is de-identified and stored without a member relation, so it cannot be associated with an account export or deletion request. |
| `prisma.hosted_linq_daily_state` | Live delete | Metadata/counts | Deletes Linq daily inbound/outbound quota counters. |
| `prisma.hosted_linq_invite_delivery` | Live delete | Metadata/counts | Deletes signup-link delivery records whose delivery identity contains the member id; unrelated operational delivery records remain under their normal retention policy. Historical orphan cleanup is finalized after production promotion and the prior-function drain. |
| `prisma.hosted_invite` | Live delete | Metadata/counts | Deletes invite codes and channel metadata owned by the member. |
| `prisma.hosted_consent_event` | Live delete | Confirmed data export | Deletes member-scoped consent event history. Confirmed export includes event scope/source/action and document metadata. |
| `prisma.hosted_consent_grant` | Live delete | Confirmed data export | Deletes member-scoped consent grant state. Confirmed export includes grant scope/source/status and document metadata. |
| `prisma.device_connection` | Live delete | Metadata/counts | Revokes providers where possible, then deletes connection rows and encrypted token bundles. |
| `prisma.device_sync_companion_capture_receipt` | Live delete | Metadata/counts | Deletes bounded operational replay receipts, identified by connection and source night with an envelope hash, before connection rows. Receipts expire after 30 days and are capped at 64 per connection. |
| `prisma.device_token_audit` | Live delete | Metadata/counts | Deletes token audit history. |
| `prisma.device_sync_signal` | Live delete | Metadata/counts | Deletes pre-existing wake/sync signals. Deletion-time provider revocation does not enqueue new disconnect or wake work. |
| `prisma.device_connect_intent` | Live delete | Metadata/counts | Deletes short-lived hosted device connect intents. Export reports safe metadata only and omits assertion/nonces and routing internals. |
| `prisma.device_provider_setup` | Pre-suspension external cleanup gate, then local delete | Metadata/counts | Before suspension, the member must disconnect the exact-bound connection and remove the exact client-ID-matched provider application through the authenticated `/connect` flow. Account-deletion preflight proves that no encrypted application binding or resumable setup-owned browser run remains. A clean registered credentials page with no client-ID element may prove prior absence; every ambiguous dashboard state fails closed. After suspension, cleanup only closes the local setup row and fails closed if that preflight was invalidated. No client credential plaintext is stored or exported. |
| `prisma.device_provider_application` | Live delete | Metadata/counts | Deletes the member's encrypted revisioned provider application after exact connection and external dashboard cleanup. Export never includes ciphertext, client id, client secret, or provider configuration. |
| `prisma.device_oauth_session` | Live delete | Metadata/counts | Deletes pending provider OAuth state. |
| `prisma.device_agent_session` | Live delete | Metadata/counts | Deletes local agent bearer-token hashes and agent session metadata. |
| `prisma.device_browser_assertion_nonce` | Live delete | Metadata/counts | Deletes outstanding browser assertion nonces. |
| `prisma.clinical_record_connect_intent` | Live delete | Metadata/counts | Deletes short-lived member-bound Clinical Records claims; raw claims are never stored or exported. |
| `prisma.clinical_record_oauth_session` | Live delete | Not exported secret | Deletes SMART state rows and encrypted PKCE verifiers; state, verifier, endpoint, and scope details are omitted from export. |
| `prisma.clinical_record_connection` | Live delete | Metadata/counts | Deletes encrypted patient context and access/refresh tokens. Canonical imported records remain governed by the vault export/deletion path. |
| `prisma.clinical_record_retrieval_run` | Live delete | Metadata/counts | Deletes generation/status/count metadata; raw FHIR bodies are never stored in this table. |
| `prisma.clinical_record_retrieval_request` | Live delete | Not exported secret | Deletes run-scoped request idempotency fingerprints and byte accounting before runs and connections; provider page URLs are not persisted here. |
| `prisma.hosted_web_internal_request_nonce` | Live delete | Metadata/counts | Deletes per-user anti-replay nonces; bounded hourly global expiry is additive and does not replace this delete. |
| `prisma.device_webhook_trace` | Live delete | Documented only | Deletes webhook traces for provider accounts linked to the member's device connections when linkage is available. User export omits trace rows and trace counts until the minimized webhook trace model has a safe user linkage. |
| `kernel.managed_auth_connections` | Live delete | Not exported secret | Deletes durable domain connections, saved credentials, and active login workflows before the member profile. Murph does not persist connection ids or credential values locally. |
| `cloudflare.runner_durable_object` | Best-effort delete | Documented only | Hosted execution control clears user runner SQL state and alarms when configured. |
| `cloudflare.r2_user_artifacts` | Best-effort delete | Documented only | Hosted execution control deletes opaque user bundle, artifact, browser vault replica, runner-secret, and raw-email objects when web-hosted domain root context is available. Root envelopes are canonical in web Postgres. |
| `temporal.per_user_runtime_workflow` | Best-effort delete | Documented only | Account deletion terminates the per-user hosted Temporal runtime workflow before local deletion starts, after the Prisma deletion commits, and after Cloudflare cleanup, stopping live writers before row deletion and neutralizing sleeping wake flags and runtime-result wake state. |
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
- clears the Durable Object alarm and then calls Durable Object storage `deleteAll()` so non-SQL keys cannot survive; already-absent state is retry-safe, and the response must explicitly confirm `deleteAllCompleted`;
- best-effort destroys the warm runner container for the deleted user so live container state does not linger until normal container expiry.

Container workspace artifacts are covered to the extent they are persisted through the existing R2/runner-state contract. Ephemeral live container filesystem state is not separately addressable by this MVP because the existing worker/container contract does not expose a per-user container filesystem wipe primitive.

A legacy Worker response without `deleteAllCompleted` is intentionally
nonterminal even when its older alarm and SQL-state booleans are true. Deploy
the capability-bearing Worker before the receipt-producing web build and keep
it as the Cloudflare rollback floor. Apply the receipt-table migration before
deploying web.

## Temporal workflow cleanup

Hosted deletion treats the per-user Temporal runtime workflow as orchestration state, not product truth. The deletion service best-effort terminates the workflow with reason `account-deleted` before provider revocation, billing cancellation, or local row deletion starts; repeats the same bounded termination after Prisma account rows are deleted successfully; and repeats it again after Cloudflare cleanup. A missing or already-finished workflow is considered cleaned up, and timeout or transport failures are logged as sanitized best-effort cleanup errors without blocking deletion or Cloudflare cleanup.

The hosted runtime reconciliation-facts endpoint also fails closed for stale workflow wakeups: if the member is missing, suspended, or not active, facts return `blocked` with reason `user_not_active` and no retry. If an active member has durable work pending but no hosted workspace row, facts return `blocked` with reason `hosted_runtime_not_configured` and no retry. Those guards prevent a sleeping workflow from turning stale mailbox, manual, or workspace wake state into a new Cloudflare execution after deletion or deactivation.

## External providers, vendors, and backups

Deletion cannot guarantee immediate erasure in systems Murph does not control. The deletion/export result therefore always carries retention notes for:

- Linq, Telegram, carrier, and email-provider copies of messages or routing events already delivered to those external systems;
- App Server provider threads, Murph session/workspace artifacts, provider
  messages, recipient devices, and backups that already contain an emitted
  address-book advisory label; deleting the live projection prevents future
  lookups but cannot recall that generated content;
- infrastructure backups and restore media that age out under documented retention.

Stripe and Privy vendor accounts are actively deleted by the deletion workflow itself: the subscription is canceled fail-closed before the local wipe, and the encrypted deletion receipt retains retry ownership for the customer and Privy user afterward. Local usage-credit purchase rows and their encrypted Stripe references are deleted with the account. Stripe retains records it is legally required to keep (for example invoices and payment records) under its own documented processes after the customer object is deleted.

The owner and owned thread-container members are locked and suspended before
the external-target snapshot is prepared. Runtime, direct and Family Stripe,
and Privy relationship writers serialize on that lifecycle fence and reject a
suspended owner; the destructive transaction re-reads the complete target set
under the same owner-first lock and aborts if it changed. Incomplete cleanup
receipts keep a searchable non-reversible Privy lookup key so a deleted identity
cannot be recreated while a delayed retry still owns deletion authority.
Provider work shares one abortable attempt deadline, with Cloudflare bearer
acquisition and request execution inside that deadline and runtime deletions
limited to a fixed worker pool.

Retell call objects are actively deleted before the local wipe. The local phone-call row remains available for retry until Retell confirms deletion or confirms that the object is already absent; account deletion does not report success while a Retell provider id remains.

## Tests

`apps/web/test/hosted-account-data-service.test.ts` covers:

- the exact destructive phrase requirement;
- rejection of lowercase, whitespace-mutated, or missing confirmation payloads;
- uniqueness and completeness of the store-coverage matrix for every high-value store listed above;
- non-empty notes plus valid deletion/export modes for each store.
- deletion ordering that stops the Temporal runtime before local deletion, atomically persists cleanup ownership before member removal, keeps external cleanup after Prisma commit, and skips external cleanup when the transaction fails.
- Temporal workflow termination ordering before deletion, after Prisma commit, and after Cloudflare cleanup, plus hosted reconciliation-facts blocking for deleted, inactive, or unconfigured users.
- durable external cleanup: receipt-bound KMS encryption, atomic receipt ownership, independent target progress, idempotent retry, searchable Privy deletion authority, lifecycle-fenced target snapshots, unconfigured-target and legacy-Worker pending state, abortable provider-attempt deadlines, lease-loss handling, fixed Cloudflare worker concurrency, and bounded batch isolation.
- Family account cleanup: owned Family subscriptions cancel fail-closed, Family memberships/invites/billing refs are deleted with account rows, and Family Stripe customer references are deduped with direct billing customer cleanup.
- Retell cleanup: terminal and active provider objects are deleted, active calls stop first, confirmed absence is retry-safe, ambiguous failures retain local provider ids, bounded extra batches require retry, and the final transaction rejects any remaining provider id or active reservation.
- usage-credit cleanup: store coverage includes purchase and ledger rows, deletion counts both stores, and ledger entries are deleted before purchases and hosted member rows.

Any future account data store should update `HOSTED_ACCOUNT_DATA_STORE_COVERAGE`, the deletion/export implementation, this document, and the coverage test in the same change.
