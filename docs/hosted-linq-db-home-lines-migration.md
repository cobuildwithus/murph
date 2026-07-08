# Hosted Linq DB Home Lines Migration

This cutover moves new hosted-member Linq home-line assignment from the env phone pool into `hosted_linq_line`.

## What Changes

- Existing sticky member routes keep using `hosted_member_routing.linq_recipient_phone_lookup_key`.
- New home-line assignment reads configured `hosted_linq_line` rows only.
- Provider-discovered rows are inventory until `configured_at` is set.
- Daily new-conversation caps are enforced at assignment time with the existing home-line advisory lock.
- Contact-card reconciliation syncs Linq provider phone inventory before reconciling DB-backed lines.

Member private phone fields remain encrypted through the hosted member secure-box path. `hosted_linq_line.phone_number_encrypted` stores provider-owned operational sending numbers encrypted with the hosted contact privacy keyring so the web app can create Linq chats without returning to the env pool after cutover.

The provider inventory client intentionally stays on the existing web-owned Linq HTTP boundary instead of adding a second SDK/client surface for one read-only operation. Its parser is pinned to the documented `phone_numbers[].phone_number`, `phone_numbers[].id`, and `phone_numbers[].reputation.status` / `reputation.reason` shape, with `health_status` accepted only as the documented deprecated status alias.

## Deploy Order

1. Deploy through the normal production web build path.

   ```bash
   pnpm release:production:migrate && pnpm build
   ```

   On main-branch Vercel production deploys, `release:production:migrate` runs Prisma migrations, regenerates the hosted web Prisma client, then runs `pnpm --dir apps/web linq:sync-lines -- --skip-provider-inventory`. The guarded line sync backfills current env-configured lines and verifies at least one configured assignable DB line exists before DB-backed assignment code serves traffic. Provider inventory sync stays on the explicit operator/contact-card path so production deploys do not depend on the Linq inventory API.

2. For an explicit operator repair or a one-off cutover outside the guarded production deploy path, run:

   ```bash
   pnpm --dir apps/web linq:sync-lines
   ```

   This full command also syncs provider inventory before the final readiness check.

3. Confirm each assignable row has:

   - `configured_at IS NOT NULL`
   - `phone_number_encrypted IS NOT NULL`
   - `egress_policy = 'enabled'`
   - `health_status IN ('healthy', 'unknown')`

4. Configure per-line warmup caps directly on `hosted_linq_line`.

## Assignment Policy

New home-line assignment ignores provider inventory rows until an operator configures them. Eligible rows must have an enabled egress policy, a healthy or unknown health status, a stored phone value, and available active/daily capacity.

Recommended starting warmup for a new line:

```sql
UPDATE hosted_linq_line
SET configured_at = NOW(),
    active_member_limit = 250,
    max_new_conversations_per_day = 10,
    warmup_started_at = NOW(),
    notes = 'Week 1 warmup cap'
WHERE provider_phone_number_id = '<LINQ_PROVIDER_PHONE_NUMBER_ID>';
```

Keep new lines below 50 net-new conversations per day unless current provider health and delivery evidence supports a higher cap. Prefer gradual ramps such as 10-20 per day for the first week.

## Contact Cards

Run or keep the existing contact-card reconciliation path enabled after line changes. Every configured or provider-discovered line should have the shared Murph name and phone contact card set up before meaningful outbound use.

## Logging

Do not log raw line phone numbers from scripts, cron output, provider sync, or migration checks. Use `phone_number_hint`, lookup keys, counts, or provider ids for operator evidence.
