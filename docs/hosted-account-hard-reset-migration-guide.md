# Hosted Account Hard Reset Migration Guide

Status snapshot: 2026-06-04

This guide describes the safest production path for giving active paid hosted
members a fresh vault/container/runtime state without making them pay again.
It is an execution guide only. Do not run mutating ad hoc SQL in production for
this reset.

## Recommendation

Use a billing-preserving hard reset.

Preserve the paid account shell and login anchors, but wipe all runtime,
workspace, channel, and device-sync state. Existing channel and wearable
connections are part of the contaminated surface because old provider retries,
old routing rows, and old dedupe gaps can repopulate a fresh mailbox after the
reset.

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

Clear or delete:

- `hosted_workspace`.
- `hosted_mailbox_item`, `hosted_mailbox_payload`,
  `hosted_mailbox_lane_counter`, and linked `hosted_ingress_latency_trace`.
- `hosted_runtime_log`.
- `hosted_user_crypto_envelope` and `hosted_user_crypto_audit`.
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
  - `device_webhook_trace` linked to the old connection identities

Do not preserve existing routing/email/device rows. They are exactly the rows
that let old external systems route into a new mailbox.

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

Add two reset-specific primitives before touching production:

1. Cloudflare quiesce endpoint or method.
   - Clear active write fence.
   - Destroy the runner container.
   - Clear alarm/wake coordination state.
   - Do not delete R2 or Durable Object state yet.
   - Return a hard success/failure result.

2. Activation-only mailbox helper.
   - Append exactly one `member.activated` mailbox item for the reset batch.
   - Do not send signup welcome side effects.
   - Do not call the normal positive-source activation helper if it can append
     welcome notification state.

For reset activation signaling, set Temporal workflow ID behavior explicitly:

- `workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE`
- `workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL`

This makes reuse of the terminated workflow ID deliberate and prevents
accidentally signaling an old still-running workflow. If a retry sees an
already-running workflow after the activation signal, the utility should verify
whether the fresh activation already started before retrying or marking the
member complete.

## Execution Sequence

Run a canary first. Then batch at one or two members at a time.

### 1. Dry Run

For the target cohort, verify:

- Member is active and not suspended.
- Billing ref exists.
- Privy or wallet identity exists. Production currently has both for all active
  members.
- Cloudflare control endpoint is reachable.
- Temporal termination and signal clients are configured.
- Provider registry can revoke Junction and WHOOP credentials.
- Aggregate row counts match expectations.

The dry run must not print direct member identifiers.

### 2. Enter Maintenance Gate

For each member, temporarily set the member as suspended before any destructive
work. Existing ingress/runtime gates check member active access, so this blocks
old inbound traffic and runtime demand during the reset window.

Keep the member suspended until Cloudflare cleanup succeeds and the fresh
activation is ready to signal.

### 3. Stop Existing Runtime

Terminate the existing per-user Temporal workflow with a reset reason tied to
the batch.

This must be a hard gate:

- If Temporal is unexpectedly unconfigured, abort that member.
- If termination fails, abort that member.
- If a describe/query check still shows a running old workflow, abort that
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

Abort if container teardown is not confirmed. A warm runner must not be able to
checkpoint old workspace state after the DB reset.

### 5. Revoke Wearables

Revoke provider access while credentials are still readable.

For this cohort, expect Junction and WHOOP only. Existing account deletion
already has provider revocation structure. Use it as the basis.

For a flawless reset, block on revoke failure unless an operator explicitly
records an override for already-invalid provider credentials. Do not delete the
local token rows first and then attempt revoke.

### 6. Reset DB State

Run one database transaction per member using the hosted onboarding transaction
options.

Inside the transaction:

1. Lock the `hosted_member` row with `FOR UPDATE`.
2. Verify the member is still in the reset maintenance gate.
3. Verify billing ref and Privy/wallet login continuity.
4. Snapshot aggregate counts for operator proof without direct identifiers.
5. Delete the member-scoped poisoned rows listed in the preservation boundary.
6. Clear phone/signup identity fields while preserving Privy/wallet fields.
7. Provision fresh hosted crypto roots for `control`, `device`, `ingress`, and
   `runtime`.
8. Append one activation-only `member.activated` mailbox item.
9. Leave the member suspended.

Expected transaction result before Cloudflare sweep:

- Billing/login/legal rows preserved.
- No routing/email/device/session rows remain.
- Old workspace and mailbox rows are gone.
- New crypto roots exist.
- One activation mailbox item exists.
- A blank workspace row exists because mailbox append upserts workspace state.

### 7. Sweep Cloudflare Data

After the DB transaction commits, call the existing Cloudflare user-data
deletion endpoint.

Require:

- Durable Object state deleted or already absent.
- Alarm cleared when supported.
- R2 object and prefix deletion supported.
- No skipped user-scoped prefixes.
- User-scoped prefixes swept:
  - hosted bundles
  - artifacts
  - browser-vault replicas
  - workspace snapshots
  - runner secrets
  - hosted email raw-message prefix

`deletedObjectCount` can be zero, but skipped prefix deletion is a blocker.

If this step fails, keep the member suspended and rerun cleanup. Do not
unsuspend a member whose DB is reset but whose old runner/R2 state may still be
reachable.

### 8. Start Fresh Runtime

Immediately before signaling, terminate/describe the Temporal workflow again if
there is any doubt about a stale run. Do not terminate after this point.

Then:

1. Clear the member's temporary suspension.
2. Signal the activation mailbox item with `signalWithStart`.
3. Require the signal to be accepted or prove that the fresh reset workflow
   already started from the same activation mailbox item.

Never run post-signal Temporal termination. It can kill the fresh workflow.

### 9. Verify Member Reset

Before moving to the next member, verify:

- Member is active and not suspended.
- Billing ref is still present.
- Privy/wallet identity is still present.
- Phone lookup and email authorization are absent.
- Routing row is absent.
- Device connections and dirty rows are absent.
- Exactly one reset activation mailbox item existed at signal time.
- Fresh crypto roots exist for all four hosted crypto domains.
- Old workspace snapshot and browser-vault refs are gone or replaced only by
  post-reset refs.
- Cloudflare cleanup result is successful.
- Runtime bootstrap processes `member.activated` without requiring old state.

## Batch-Level Verification

After the full cohort:

- Active paid member count remains unchanged.
- Billing refs remain present for every reset member.
- No reset member has old routing, email authorization, phone lookup, web
  session, device connection, device dirty, or old mailbox rows.
- No reset member has pre-reset workspace snapshot refs.
- Active hosted crypto root count is four per reset member.
- Temporal workflows are running only from post-reset activation signals.
- Cloudflare deletion results are successful for every reset member.
- Provider dashboards do not show still-authorized revoked connections unless
  explicitly overridden as already-invalid.

## Abort And Recovery Rules

Abort before DB mutation when:

- Billing/login continuity is missing.
- Temporal termination fails.
- Cloudflare quiesce fails.
- Provider revoke fails without explicit override.

If the DB transaction fails:

- The member remains suspended.
- Cloudflare full deletion has not run yet.
- Fix the cause and rerun from the same member.

If the DB transaction succeeds but Cloudflare full deletion fails:

- Keep the member suspended.
- Rerun Cloudflare cleanup until successful.
- Do not restore old R2/workspace state.

If activation signal fails after cleanup:

- Keep the fresh DB state.
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
- No logs or artifacts containing raw member identifiers, emails, phone
  numbers, provider account identifiers, provider tokens, or secrets.

## Canary Checklist

Run one canary first and stop until all checks pass:

- Dry-run aggregates match expected row classes.
- Maintenance gate blocks runtime demand.
- Temporal old workflow is terminated and closed.
- Cloudflare quiesce destroys or confirms absence of the warm runner.
- Provider revocation completes or has an explicit invalid-token override.
- DB transaction preserves billing/login/legal and wipes poisoned state.
- Cloudflare full sweep deletes/skips nothing unsafe.
- Activation signal starts a fresh workflow with the same deterministic workflow
  ID.
- Fresh runtime bootstraps from `member.activated`.
- User can log in without paying again.
- User sees reconnect-required state for channels and wearables.

Only then continue with the rest of the active paid cohort.
