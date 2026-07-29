# Hosted Linq DB Home Lines Migration

This cutover moves new hosted-member Linq home-line assignment from the env phone pool into `hosted_linq_line` and replaces the legacy direct-member target with weighted line planning.

## What Changes

- Existing sticky member routes keep using `hosted_member_routing.linq_recipient_phone_lookup_key`.
- New home-line assignment reads configured `hosted_linq_line` rows only.
- Provider-discovered rows are inventory until `configured_at` is set.
- Planning load is derived on demand as `10 * active direct members + 25 * provisioned Linq group threads`.
- Direct-member counts come from canonical member home-line bindings. Group counts come from `hosted_thread_route.account_lookup_key`, which is projected atomically from the canonical encrypted delivery route rather than inferred from the container owner.
- Lines below 5,000 planned messages are preferred. If every otherwise eligible line is at or above 5,000, assignment selects the least-loaded line instead of rejecting the member.
- Daily new-conversation caps remain a separate proactive/deliverability guard enforced at assignment time with the existing home-line advisory lock.
- Contact-card reconciliation syncs Linq provider phone inventory before reconciling DB-backed lines.

The 5,000 value is only a soft assignment target. A healthy line contacted by a member-initiated first inbound keeps that conversation on the contacted line without consulting planning load or proactive pacing; weighted selection applies to proactive placement and genuinely degraded-line fallback. Planning does not cap traffic and must not reject inbound group provisioning, inbound messages, or replies in an existing conversation. Linq's 7,000 combined inbound-plus-outbound messages per line per UTC day remains the provider performance guideline. Existing line-keyed `HostedLinqProviderEvent` and `HostedLinqDelivery` rows remain the traffic-observability owners; this rollout adds no 5,000- or 7,000-message runtime rejection path.

Member private phone fields remain encrypted through the hosted member secure-box path. `hosted_linq_line.phone_number_encrypted` stores provider-owned operational sending numbers encrypted with the hosted contact privacy keyring so the web app can create Linq chats without returning to the env pool after cutover.

The provider inventory client intentionally stays on the existing web-owned Linq HTTP boundary instead of adding a second SDK/client surface for one read-only operation. Its parser is pinned to the documented `phone_numbers[].phone_number`, `phone_numbers[].id`, and `phone_numbers[].reputation.status` / `reputation.reason` shape, with `health_status` accepted only as the documented deprecated status alias.

## Deploy Order

1. Deploy through the normal production web build path.

   ```bash
   pnpm release:production:migrate && pnpm build
   ```

   On main-branch Vercel production deploys, `release:production:migrate` runs Prisma migrations, regenerates the hosted web Prisma client, then runs `pnpm --dir apps/web linq:sync-lines -- --skip-provider-inventory`. The new migration only adds nullable `hosted_thread_route.account_lookup_key` plus its query index, so a successful predeploy migration remains compatible with the previously deployed application if a later build step fails. Do not drop `hosted_linq_line.active_member_limit` in this rollout.

   The guarded line sync backfills current env-configured lines and verifies at least one configured assignable DB line exists before DB-backed assignment code serves traffic. Provider inventory sync stays on the explicit operator/contact-card path so production deploys do not depend on the Linq inventory API.

2. Wait until the new application build is live, then dry-run one bounded route-projection batch with production environment injection:

   ```bash
   NODE_OPTIONS=--conditions=react-server \
     vercel env run --environment=production -- \
     pnpm --dir apps/web linq:backfill-thread-route-accounts -- --batch-size 50
   ```

   Output is aggregate-only. A nonzero `invalidRows` count means encrypted route material or its blinded lookup authority needs operator investigation; the script leaves those rows null and readiness incomplete.

3. Freeze rollbacks, prove the production alias points at the replacement build, wait `HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS`, and prove the alias again. If the alias changes, restart the full drain against the selected compatible build. Applying before this point is unsafe because an in-flight previous function can still create a null projection after a batch has passed it.

4. Apply bounded, idempotent batches until `remainingRows` reaches zero:

   ```bash
   NODE_OPTIONS=--conditions=react-server \
     vercel env run --environment=production -- \
     pnpm --dir apps/web linq:backfill-thread-route-accounts -- --apply --batch-size 50
   ```

   Each write rechecks the legacy row's null projection, channel, container, encrypted route value, lookup keys, and `updated_at`, so concurrent canonical refresh wins instead of being overwritten.

5. Prove readiness:

   ```bash
   NODE_OPTIONS=--conditions=react-server \
     vercel env run --environment=production -- \
     pnpm --dir apps/web linq:backfill-thread-route-accounts -- --check
   ```

   `--check` exits nonzero while any Linq or Telegram route remains unprojected. Assignment remains available during backfill; it surfaces incomplete coverage and applies the same conservative unknown group weight to every candidate rather than attributing a group to an owner line or claiming exact spare capacity.

6. For an explicit operator repair or a one-off line cutover outside the guarded production deploy path, run:

   ```bash
   pnpm --dir apps/web linq:sync-lines
   ```

   This full command also syncs provider inventory before the final readiness check.

7. Confirm each assignable line row has:

   - `configured_at IS NOT NULL`
   - `phone_number_encrypted IS NOT NULL`
   - `egress_policy = 'enabled'`
   - `health_status IN ('healthy', 'unknown')`

8. Configure per-line proactive warmup caps directly on `hosted_linq_line`.

## Assignment and Warmup Policy

Eligible rows must have an enabled egress policy, a healthy or unknown health status, and a stored phone value. Weighted planning chooses among those rows; `max_new_conversations_per_day` independently controls proactive first-contact pacing.

Recommended starting warmup for a new line:

```sql
UPDATE hosted_linq_line
SET configured_at = NOW(),
    max_new_conversations_per_day = 10,
    warmup_started_at = NOW(),
    notes = 'Week 1 proactive warmup cap'
WHERE provider_phone_number_id = '<LINQ_PROVIDER_PHONE_NUMBER_ID>';
```

Keep new lines below 50 net-new conversations per day unless current provider health and delivery evidence supports a higher cap. Prefer gradual ramps such as 10-20 per day for the first week. This pacing value is not the weighted line-planning score and is not the provider's 7,000-message guideline.

`active_member_limit` and `HOSTED_ONBOARDING_LINQ_MAX_ACTIVE_MEMBERS_PER_PHONE_NUMBER` are retained only as an additive-rollout compatibility seam for an older rollback build. Current assignment neither reads nor treats them as policy. Remove the env seam and column only in a later contract cleanup after no production or rollback function can execute the old direct-member decision.

## Contact Cards

Run or keep the existing contact-card reconciliation path enabled after line changes. Every configured or provider-discovered line should have the shared Murph name and phone contact card set up before meaningful outbound use.

## Logging

Do not log raw line phone numbers, thread ids, member ids, account lookup keys, plaintext, or ciphertext from scripts, provider sync, or migration checks. Use phone hints, aggregate counts, or provider ids for operator evidence.
