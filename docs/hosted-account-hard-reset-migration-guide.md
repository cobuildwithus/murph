# Hosted Account Hard Reset Migration Guide

Status snapshot: 2026-06-04

Stress-test status: do not execute this runbook until the reset-specific
barriers, crypto handling, and canary tests below are implemented. Three
independent review passes found that a simple delete/recreate script can
re-poison fresh accounts through stale runtime callbacks, old provider retries,
or undecryptable preserved identity fields.

This guide describes the safest production path for giving active paid hosted
members a fresh vault/container/runtime state without making them pay again.
It is an execution guide only. Do not run mutating ad hoc SQL in production for
this reset.

## Recommendation

Use a billing-preserving hard reset, implemented as a versioned reset
operation.

Preserve the paid account shell and login anchors, but wipe runtime,
workspace, channel, and device-sync state. Existing channel and wearable
connections are part of the contaminated surface because old provider retries,
old routing rows, stale runtime callbacks, and old dedupe gaps can repopulate a
fresh mailbox after the reset.

The reset must carry a durable `batch_id` plus a per-member monotonic
`reset_generation` across web, Temporal, Cloudflare Durable Objects, R2 cleanup,
workspace checkpoint callbacks, browser-vault publish callbacks, and device or
channel ingress gates. `suspended_at` is useful as a user-facing secondary gate,
but it is not a complete reset lock because billing reconciliation and ingress
paths can still write state unless they check a reset-specific barrier.

Customer-facing result:

- Members do not need to pay again.
- Members keep the same paid account through Privy/wallet login.
- Members must reconnect messaging/email channels and wearables.
- Members receive a fresh hosted workspace/vault/runtime bootstrap.

## Production DB Shape

DBHub production inspection found:

- 19 hosted members: 10 active, 9 not started.
- Active reset cohort: 10 active, non-suspended paid members.
- Active cohort continuity:
  - 10/10 billing refs.
  - 10/10 identity rows.
  - 10/10 Privy lookup present.
  - 10/10 wallet lookup present.
  - 9/10 phone lookup present.
  - 9/10 email authorization present.
  - 10/10 workspace rows with snapshot and browser-vault refs.
  - 10/10 active hosted crypto-root owners.
  - 10/10 legal/health-data consent grants.
- Active cohort runtime/device state:
  - 12,553 hosted mailbox items.
  - 352,930 hosted runtime logs at inspection time.
  - 10 hosted workspaces.
  - 40 hosted crypto envelope/audit rows.
  - 3,287 hosted AI usage rows, all `stripe_meter_status = 'skipped'`.
  - 9 device connections across 9 active members.
  - 9,741 device sync signals.
  - 333 dirty device-sync payload rows.
- Device provider split:
  - 5 Junction connections, status `active`, credential kind `provider_config`.
  - 4 WHOOP connections, status `reauthorization_required`, credential kind
    `oauth_tokens`.

Re-run DBHub preflight immediately before production execution. Counts can
change while production is live.

## Preservation Boundary

Preserve:

- `hosted_member` rows for targeted active paid members.
- `hosted_member_billing_ref`.
- `hosted_member_identity` Privy and wallet lookup/encrypted fields.
- `hosted_consent_event` and `hosted_consent_grant` for launch legal and
  health-data consent scopes.
- `hosted_stripe_event`.
- `hosted_assistant_runtime_issue`, which is anonymized and not member-scoped.
- Processed provider webhook replay protection until each provider retry horizon
  expires, either as retained `device_webhook_trace` rows or reset tombstones
  keyed by provider/account/event identity.
- A decryptable control crypto root, unless the reset transaction rewraps every
  preserved identity and billing ciphertext onto a fresh control root before the
  old root is retired.

Clear or delete:

- `hosted_workspace`.
- `hosted_mailbox_item`, `hosted_mailbox_payload`,
  `hosted_mailbox_lane_counter`, and linked `hosted_ingress_latency_trace`.
- `hosted_runtime_log` rows from before the reset transaction. Fresh activation
  append/runtime logs created after the reset are expected.
- `hosted_user_crypto_envelope` and `hosted_user_crypto_audit` for old `device`,
  `ingress`, and `runtime` domains. Do not delete the old `control` domain
  envelope before preserved login/billing ciphertext is either rewrapped or
  proven decryptable through a retained decrypt-only root.
- `hosted_ai_usage` and `hosted_ai_usage_period`.
- `hosted_linq_daily_state`.
- `hosted_invite`.
- `hosted_web_session`.
- `hosted_web_internal_request_nonce`.
- `hosted_member_routing`.
- `hosted_member_email_authorization`.
- Phone/signup fields on `hosted_member_identity`:
  - `masked_phone_number_hint`
  - `phone_lookup_key`
  - `phone_number_encrypted`
  - `phone_number_verified_at`
  - `signup_phone_number_encrypted`
  - `signup_phone_code_sent_at`
  - `signup_phone_code_send_attempt_id`
  - `signup_phone_code_send_attempt_started_at`
- Device-sync state:
  - `device_connection`
  - `device_connection_source` through cascade
  - `device_token_audit`
  - `device_sync_signal`
  - `device_sync_dirty_connection`
  - `device_sync_dirty_payload`
  - `device_oauth_session`
  - `device_connect_intent`
  - `device_agent_session`
  - `device_browser_assertion_nonce`
  - in-progress or expired `device_webhook_trace` locks, after processed replay
    protection has been retained or migrated to reset tombstones

Do not preserve existing routing/email/device rows. They are exactly the rows
that let old external systems route into a new mailbox.

Do not preserve channel feature consent such as WhatsApp messaging consent unless
the channel remains explicitly disabled by reset generation. Current production
only has launch legal and health-data consent scopes in the active cohort, but
the utility must fail closed if future channel consent scopes appear: either
clear them and require re-consent, or preserve them only with an explicit
channel-disabled state that prevents inbound routing until reconnect.

## Required Implementation Before Execution

Ship a reset utility in the hosted web control plane, not a manual SQL script.
It should support:

- `--dry-run`
- `--execute`
- `--batch-id`
- `--target active-paid`
- `--member-id` for canary execution
- aggregate-only logs
- no raw member ids, emails, phone numbers, provider account ids, tokens, or
  direct identifiers in logs

The utility should reuse existing app services where possible:

- Existing provider revoke logic from hosted account deletion.
- Existing Prisma deletion order from hosted account deletion, adjusted to
  preserve billing/login/legal rows.
- Existing crypto root provisioning helper.
- Existing mailbox append helper.
- Existing Temporal signal path, with reset-specific workflow ID policies.

Add these reset-specific primitives before touching production:

1. Durable reset operation state in the hosted web control plane.
   - Store `batch_id`, member pointer, monotonic `reset_generation`, current
     phase, activation mailbox item id, Temporal run id/start time when known,
     Cloudflare barrier token, aggregate proof counts, and timestamps.
   - Logs and operator output must stay aggregate-only. Do not print raw member
     ids or external account identifiers.
   - Stripe and login reconciliation must not be able to clear this reset lock.
   - Recovery must resume from this state instead of guessing from partial row
     deletion.

2. Workspace/reset-generation fencing.
   - Add a reset generation or equivalent monotonic workspace epoch to hosted
     workspace state and every runtime callback that can mutate workspace,
     browser-vault, mailbox, runtime log/status, device dirty ack, or usage
     state.
   - Workspace checkpoint compare-and-swap must reject stale callbacks by
     checking `userId + reset_generation + version`, or by preserving a
     monotonic workspace version that cannot match any pre-reset callback.
   - A post-reset workspace must not restart at version `0` unless the callback
     generation is also enforced.

3. Cloudflare reset barrier/quiesce endpoint or method.
   - Clear active write fence.
   - Destroy the runner container.
   - Clear alarm/wake coordination state even when no active write fence exists.
   - Retire direct-R2 upload sessions.
   - Install a reset tombstone/barrier keyed by batch and reset generation.
   - Reject ensure-processing, prewarm, snapshot, browser-vault, provider, and
     checkpoint paths for older generations until fresh activation releases the
     barrier.
   - Do not delete R2 or non-barrier Durable Object state yet.
   - Return a hard success/failure result.

4. Batch-scoped Cloudflare cleanup.
   - Existing user-data deletion is user-scoped and must not be reused as-is.
   - Cleanup must require a signed batch/phase token or one-time nonce.
   - Cleanup must be rejected after the reset has been released/activated.
   - Durable Object cleanup must either preserve/recreate the reset barrier in
     the same operation or prove a separate generation gate will reject stale
     callbacks.
   - Cleanup must list/delete all known DO storage keys or return remaining-key
     counts; `runner_meta` deletion alone is not proof that DO state is gone.
   - R2 deletion must repeat list/delete until target prefixes are empty after
     direct-R2 upload sessions are retired.

5. Activation-only mailbox helper.
   - Append exactly one `member.activated` mailbox item for the reset batch.
   - Do not send signup welcome side effects.
   - Do not call the normal positive-source activation helper if it can append
     welcome notification state.
   - Use a stable dedupe key derived from batch and reset generation so retries
     reuse the same activation mailbox item.

6. Reset-aware ingress and login gates.
   - Device webhooks, email callbacks, messaging webhooks, dirty-state writes,
     mailbox appends, and runtime nudges must check the reset generation
     immediately before writing.
   - Privy login may prove account ownership, but it must not recreate phone,
     email authorization, Telegram, Linq, WhatsApp, or reply-alias routing until
     the user explicitly reconnects that channel.
   - Linq/WhatsApp acquisition paths need reset-cohort retired contact/chat
     tombstones or an equivalent suppression rule so old first-contact replays
     cannot create shadow members or routes.

For reset activation signaling, set Temporal workflow ID behavior explicitly:

- `workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE`
- `workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL`

This makes reuse of the terminated workflow ID deliberate and prevents
accidentally signaling an old still-running workflow. If a retry sees an
already-running workflow after the activation signal, the utility should verify
whether the fresh activation already started before retrying or marking the
member complete.

The current signal helper types must be widened or a reset-specific signal
helper must be added before execution. The implementation must test that these
exact policies are passed, that a terminated workflow ID can be reused, and that
a live old workflow conflicts instead of receiving the reset activation signal.

## Execution Sequence

Run a canary first. Then batch at one or two members at a time.

### 1. Dry Run

For the target cohort, verify:

- Member is active and not suspended.
- Billing ref exists.
- Privy or wallet identity exists. Production currently has both for all active
  members.
- Preserved identity and billing ciphertext can be decrypted before any crypto
  root changes.
- Cloudflare control endpoint is reachable.
- Temporal termination and signal clients are configured.
- Provider registry can revoke Junction and WHOOP credentials.
- Every target `hosted_ai_usage` row is in an explicitly approved non-billable
  or final state before deletion. Abort if metering state has changed.
- No non-expired nullable-user `device_oauth_session` row can complete into the
  target member through metadata or pending connect state.
- Processed device webhook traces are either retained through provider retry
  horizons or have reset tombstones ready.
- Consent scopes are limited to the allowed launch legal/health-data scopes, or
  future channel consent scopes are scheduled for explicit re-consent.
- Aggregate row counts match expectations.

The dry run must not print direct member identifiers.

### 2. Enter Maintenance Gate

For each member, create or resume the durable reset operation, allocate the next
`reset_generation`, and enter a reset lock before any destructive work.

Also temporarily set the member as suspended. Existing ingress/runtime gates may
check active access, but suspension is only a secondary gate; the reset lock and
generation checks are the primary write barrier.

Keep the member suspended until Cloudflare cleanup succeeds and the fresh
activation is ready to signal.

Abort if billing reconciliation, login sync, device ingress, email ingress, or
messaging ingress can write for the member without checking the reset lock.

### 3. Stop Existing Runtime

Terminate the existing per-user Temporal workflow with a reset reason tied to
the batch.

This must be a hard gate:

- If Temporal is unexpectedly unconfigured, abort that member.
- If termination fails, abort that member.
- If a describe/query check still shows a running old workflow, abort that
  member.
- If termination times out or the workflow close state is ambiguous, abort that
  member.

Do not rely on the current best-effort account-deletion helper without checking
its result.

### 4. Quiesce Cloudflare

Call the reset-specific Cloudflare quiesce endpoint.

Require:

- Active write fence cleared or absent.
- Runner container destroy attempted when applicable.
- Runner container destroy confirmed.
- Runner alarm/wake state cleared.
- Direct-R2 upload sessions retired.
- Reset barrier installed for the batch and reset generation.
- Stale ensure-processing, prewarm, snapshot, checkpoint, browser-vault, and
  provider paths rejected while the barrier is active.

Abort if container teardown is not confirmed. A warm runner must not be able to
checkpoint old workspace state after the DB reset.

### 5. Revoke Wearables

Revoke provider access while credentials are still readable.

For this cohort, expect Junction and WHOOP only. Existing account deletion
already has provider revocation structure. Use it as the basis.

For a flawless reset, block on revoke failure, warning, or skipped-not-configured
results unless an operator explicitly records an override with proof that the
credential is already invalid and cannot be used. Do not delete the local token
rows first and then attempt revoke.

### 6. Reset DB State

Run one database transaction per member using the hosted onboarding transaction
options.

Inside the transaction:

1. Lock the `hosted_member` row with `FOR UPDATE`.
2. Lock the reset operation row and verify the expected `batch_id`,
   `reset_generation`, and phase.
3. Verify the member is still in the reset maintenance gate.
4. Verify billing ref and Privy/wallet login continuity.
5. Decrypt/read back preserved identity and billing fields before changing crypto
   roots.
6. Snapshot aggregate counts for operator proof without direct identifiers.
7. Delete the member-scoped poisoned rows listed in the preservation boundary.
8. Clear phone/signup identity fields while preserving Privy/wallet fields.
9. Mark channels as reconnect-required for this reset generation so login sync
   cannot silently recreate routing.
10. Preserve the old `control` root as decrypt-only, or rewrap preserved identity
    and billing ciphertext onto a fresh control root and prove readback before
    retiring the old root.
11. Provision fresh hosted crypto roots for `device`, `ingress`, and `runtime`.
12. Create fresh workspace state with reset generation fencing. Do not create a
    version-0 workspace that can accept pre-reset callbacks unless generation is
    enforced in callback CAS.
13. Append one activation-only `member.activated` mailbox item with the stable
    reset dedupe key and store its id on the reset operation.
14. Leave the member suspended.

Expected transaction result before Cloudflare sweep:

- Billing/login/legal rows preserved.
- No routing/email/device/session rows remain.
- Old workspace and mailbox rows are gone.
- Preserved identity and billing fields decrypt successfully.
- Fresh device/ingress/runtime crypto roots exist, and control is either fresh
  after rewrap or retained decrypt-only for preserved continuity.
- One activation mailbox item exists.
- A blank workspace row exists with reset-generation fencing.

### 7. Sweep Cloudflare Data

After the DB transaction commits, call the batch-scoped Cloudflare cleanup
endpoint. Do not call a user-scoped deletion endpoint that can also delete fresh
post-activation state.

Require:

- Durable Object state deleted or already absent.
- Alarm cleared when supported.
- R2 object and prefix deletion supported.
- No skipped user-scoped prefixes.
- Reset barrier preserved or recreated after DO cleanup.
- Direct-R2 upload sessions retired before prefix sweep.
- R2 prefixes repeatedly swept until empty.
- DO remaining-key count is zero except the explicit reset barrier, or every
  retained key is listed as an allowed reset-barrier key.
- User-scoped prefixes swept:
  - hosted bundles
  - artifacts
  - browser-vault replicas
  - workspace snapshots
  - runner secrets
  - hosted email raw-message prefix

`deletedObjectCount` can be zero, but skipped prefix deletion or an unknown
remaining DO key is a blocker.

If this step fails, keep the member suspended and rerun cleanup. Do not
unsuspend a member whose DB is reset but whose old runner/R2 state may still be
reachable.

### 8. Start Fresh Runtime

Immediately before signaling, terminate/describe the Temporal workflow again if
there is any doubt about a stale run. Do not terminate after this point.

Then:

1. Move the reset operation into activation phase.
2. Clear the member's temporary suspension while keeping channel reconnect flags.
3. Release the Cloudflare reset barrier only for the current reset generation.
4. Signal the activation mailbox item with `signalWithStart`.
5. Store Temporal run id/start time when available.
6. Require the signal to be accepted or prove that the fresh reset workflow
   already started from the same activation mailbox item.

Never run post-signal Temporal termination. It can kill the fresh workflow.

### 9. Verify Member Reset

Before moving to the next member, verify:

- Member is active and not suspended.
- Billing ref is still present.
- Privy/wallet identity is still present and decrypts.
- Billing settings or portal customer lookup still reads the preserved Stripe
  reference.
- Phone lookup and email authorization are absent.
- Routing row is absent.
- Device connections and dirty rows are absent.
- Exactly one reset activation mailbox item existed at signal time.
- Fresh device/ingress/runtime crypto roots exist; control root continuity is
  proven by readback or rewrap proof.
- Old workspace snapshot and browser-vault refs are gone or replaced only by
  post-reset refs.
- Cloudflare cleanup result is successful.
- Runtime bootstrap processes `member.activated` without requiring old state.
- No pre-reset runtime logs remain. Post-reset activation/runtime logs are
  allowed and should be scoped by timestamp and batch.
- A delayed pre-reset workspace checkpoint/browser-vault callback is rejected.
- A delayed pre-reset Cloudflare ensure-processing request cannot start a runner.
- Device webhook and email callbacks delivered during reset are dropped with no
  dirty rows, mailbox rows, or runtime nudges.
- First post-reset Privy login does not recreate phone, email, Telegram, Linq,
  WhatsApp, or reply-alias routing before explicit reconnect.

## Batch-Level Verification

After the full cohort:

- Active paid member count remains unchanged.
- Billing refs remain present for every reset member.
- No reset member has old routing, email authorization, phone lookup, web
  session, device connection, device dirty, or old mailbox rows.
- No reset member has pre-reset workspace snapshot refs.
- Fresh device/ingress/runtime crypto roots exist per reset member; control root
  is either fresh after rewrap or retained decrypt-only with readback proof.
- Temporal workflows are running only from post-reset activation signals.
- Cloudflare deletion results are successful for every reset member.
- Provider dashboards do not show still-authorized revoked connections unless
  explicitly overridden as already-invalid.

## Abort And Recovery Rules

Abort before DB mutation when:

- Billing/login continuity is missing.
- Preserved login/billing ciphertext cannot be decrypted.
- Temporal termination fails.
- Cloudflare quiesce fails.
- Provider revoke fails without explicit override.
- Reset-aware ingress/login gates are not deployed.
- Workspace generation or monotonic-version fencing is not deployed.

If the DB transaction fails:

- The member remains suspended.
- Cloudflare full deletion has not run yet.
- Fix the cause and rerun from the same member.

If the DB transaction succeeds but Cloudflare full deletion fails:

- Keep the member suspended.
- Keep the Cloudflare reset barrier active.
- Rerun Cloudflare cleanup until successful.
- Do not restore old R2/workspace state.

If Cloudflare cleanup times out locally:

- Treat the member as incomplete.
- Keep the member suspended and barriered.
- Retry only with the same batch/phase token.
- Do not unsuspend until the cleanup endpoint proves no old R2/DO state remains.
- After activation, the cleanup token must no longer be accepted, so a late retry
  cannot delete fresh state.

If activation signal fails after cleanup:

- Keep the fresh DB state.
- Keep the reset operation with the activation mailbox item id.
- Retry the activation signal.
- If a workflow is already running, verify it is the fresh reset workflow before
  marking the member complete.

There is no rollback to old runtime state after R2/workspace deletion. Recovery
means completing cleanup and bootstrap, not restoring contaminated state.

## Non-Goals

- No forced repay or re-signup unless billing/login continuity checks fail.
- No preservation of wearable connections.
- No preservation of old channel routing.
- No preservation of old workspace snapshots, browser vault replicas, or runner
  secrets.
- No manual production mutation outside the reviewed utility.
- No user-scoped Cloudflare deletion after fresh activation.
- No logs or artifacts containing raw member identifiers, emails, phone
  numbers, provider account identifiers, provider tokens, or secrets.

## Canary Checklist

Run one canary first and stop until all checks pass:

- Dry-run aggregates match expected row classes.
- Maintenance gate blocks runtime demand.
- Reset lock blocks Stripe/login/channel/device ingress writes.
- Temporal old workflow is terminated and closed, not ambiguous.
- Cloudflare quiesce destroys or confirms absence of the warm runner and installs
  a reset barrier.
- Provider revocation completes or has an explicit invalid-token override.
- DB transaction preserves billing/login/legal and wipes poisoned state.
- Preserved identity/billing fields decrypt after crypto-root handling.
- Cloudflare full sweep deletes/skips nothing unsafe.
- Duplicate or late Cloudflare cleanup cannot delete fresh state after
  activation.
- Delayed pre-reset workspace checkpoint/browser-vault publish is rejected.
- Delayed pre-reset ensure-processing cannot start a runner.
- Old provider webhook replay is accepted-and-dropped with no dirty rows.
- First post-reset Privy login does not restore channel routing automatically.
- Activation signal starts a fresh workflow with the same deterministic workflow
  ID.
- Fresh runtime bootstraps from `member.activated`.
- User can log in without paying again.
- User sees a fresh connect path for channels and wearables. If the UI should
  show specific prior provider names, preserve only non-secret reset artifacts
  such as provider/source slugs; otherwise present a generic fresh-connect state.

Only then continue with the rest of the active paid cohort.
