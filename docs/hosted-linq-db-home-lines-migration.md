# Hosted Linq DB Home Lines Migration

This cutover moves new hosted-member Linq home-line assignment from the env phone pool into `hosted_linq_line` and replaces the legacy direct-member target with weighted line planning.

## What Changes

- Existing sticky member routes keep using `hosted_member_routing.linq_recipient_phone_lookup_key`.
- New home-line assignment reads configured `hosted_linq_line` rows only.
- Provider-discovered rows are inventory until `configured_at` is set.
- Planning load is derived on demand as `10 * active direct members + 25 * provisioned Linq group threads`.
- Direct-member counts come from canonical member home-line bindings. Group counts come from `hosted_thread_route.account_lookup_key`, which is projected atomically from the canonical encrypted delivery route rather than inferred from the container owner.
- Lines below 5,000 planned messages are preferred. If every otherwise eligible line is at or above 5,000, assignment selects the least-loaded line instead of rejecting the member.
- Within the below-target pool, genuinely new non-preferred placement ranks exact trailing-168-hour accepted-outbound plus inbound-message effects before weighted planning load and today's new-conversation count. If every line is at or above target, weighted planning load remains the first fallback signal and recent traffic breaks planning ties.
- Daily new-conversation caps remain a separate proactive/deliverability guard enforced by conditional updates to the selected line's UTC-day counter.
- Contact-card reconciliation syncs Linq provider phone inventory before reconciling DB-backed lines.

The 5,000 value is only a soft assignment target. A healthy line contacted by a member-initiated first inbound keeps that conversation on the contacted line without consulting planning load or proactive pacing; weighted selection applies to proactive placement and genuinely degraded-line fallback. Planning does not cap traffic and must not reject inbound group provisioning, inbound messages, or replies in an existing conversation. Linq's 7,000 combined inbound-plus-outbound messages per line per UTC day remains the provider performance guideline. Existing line-keyed `HostedLinqProviderEvent` and `HostedLinqDelivery` rows remain the traffic-observability owners; this rollout adds no 5,000- or 7,000-message runtime rejection path.

Member private phone fields remain encrypted through the hosted member secure-box path. `hosted_linq_line.phone_number_encrypted` stores provider-owned operational sending numbers encrypted with the hosted contact privacy keyring so the web app can create Linq chats without returning to the env pool after cutover.

The provider inventory client intentionally stays on the existing web-owned Linq HTTP boundary instead of adding a second SDK/client surface for one read-only operation. Its parser is pinned to the documented `phone_numbers[].phone_number`, `phone_numbers[].id`, and `phone_numbers[].reputation.status` / `reputation.reason` shape, with `health_status` accepted only as the documented deprecated status alias.

Inventory replacement prepares at most 250 lines once, before opening any
database transaction. The existing Serializable owner attempts the complete
atomic replacement at most three times, recognizing both Prisma-wrapped
statement conflicts and direct adapter SQLSTATE conflicts at commit. A retry
waits 50–250 milliseconds after rollback, outside the transaction, so the two
possible waits add at most 500 milliseconds without changing the default
transaction timeout. Cancellation interrupts the wait and is checked before
each new attempt. Unrecognized errors remain terminal; retries do not refetch
the provider snapshot or repeat crypto preparation. Callers supplying their own
transaction retain responsibility for retrying that entire transaction.

## Line Identity and Capacity Locking

`linq-line-store.ts` owns singular line upserts. It first reads only the primary
keys matching the normalized phone's current and retained privacy-key candidates
(at most two). An existing row is updated directly, preserving its lookup key,
refreshing its encrypted phone and hint, and retaining the source-specific
metadata writes. Runtime line writers do not move or delete these primary keys.
The row write serializes with proactive-capacity updates on that same identity;
an existing-row upsert must not subsequently acquire the phone advisory lock.

Only an initially missing row takes
`pg_advisory_xact_lock(hashtext('hosted_linq_line_phone'), hashtext(normalizedPhone))`.
It then rereads the same candidates under the lock before choosing a row to
update or create. This recheck preserves the existing current-key preference and
legacy-key reuse when another singular creator commits while this one waits.
The public upsert keeps both reads, the lock, and the write inside one transaction
when given a root client. Existing stronger-isolation conflict handling remains
with the caller; this is not an added transaction retry.

This contract permits capacity followed by delivery claim in email recovery,
home-line reservation, and group-join outreach without a line-row-to-phone-lock
cycle against an ordinary upsert. The capacity predicates, atomic UTC rollover,
delivery authorization, durable idempotency, and delivery success criteria retain
their existing owners. Line encryption is local; this owner makes no provider or
KMS call. Direct email recovery still calls the provider after its preparation
transaction commits.

The application-call bounds below count awaited Prisma operations, excluding
`BEGIN`/`COMMIT` and unchanged provider/outcome work:

| Composed segment | Previous maximum | Current maximum |
| --- | ---: | ---: |
| Existing line, webhook/configured singular upsert | 3 | 2 |
| Initially missing line, webhook/configured singular upsert | 3 | 4 |
| Existing line capacity plus provider dispatch claim, including claim conflict/reclaim branches | 9 | 8 |
| Fresh email-recovery preparation, uncontended delivery insert, including day rollover | 12 | 11 |
| Email-recovery preparation including delivery insert conflict/reclaim | 14 | 13 |

Provider-source upserts add one guarded `providerFirstSeenAt` update in either
version. Each candidate read uses at most two keys and selects only the primary
key. The extra read occurs only when the initial read is empty; established-line
foreground dispatch removes one advisory-lock call. Transaction timeouts and
existing retry policies are unchanged, and no numeric production latency
improvement is inferred from these bounds.
Operations remain serial on the existing transaction connection; this change
adds no concurrent query, pool slot, or transaction.

At the existing 250-line pool cap, home-line reservation still makes at most
1,004 calls (pool read, two planning reads, recent-effects read, and two attempts
of at most two conditional writes per candidate). Composing it with one
existing-line dispatch claim changes that segment's bound from 1,011 to 1,010.
Outreach's healthy-pool read, planning reads, and at most two capacity writes per
candidate remain at most 504 calls; including its dispatch claim changes that
segment from 511 to 510. These bounds exclude unchanged member/group authority,
pacing, and outcome work; no candidate loop or concurrency is added.

The opt-in `apps/web/test/linq-line-lock-order-diagnostic.test.ts` regression
uses only synthetic rows in an isolated loopback PostgreSQL database. It retains
the exact lock namespace as a scheduling barrier and exercises real capacity,
line-upsert, and transport/delivery owners. Unit proof also covers a creator that
finds a legacy row only after acquiring the phone lock.

## Deploy Order

1. Stop before any production migration, deployment, rollback freeze, dry run,
   or protected-identity use. The route-projection backfill requires both
   production database access and hosted crypto authority, and it has no
   approved local execution path. Explain the required operation, authorities,
   alias proofs, drain, and convergence gates to the user before implementation
   or execution. Do not retrieve or inject a production secret locally or
   invent a workflow or endpoint while waiting for the decision.

2. Any later user-authorized hosted or protected path may deploy through the
   normal production web build path.

   ```bash
   pnpm release:production:migrate && pnpm build
   ```

   On main-branch Vercel production deploys, `release:production:migrate` runs Prisma migrations, regenerates the hosted web Prisma client, then runs `pnpm --dir apps/web linq:sync-lines -- --skip-provider-inventory`. The new migration only adds nullable `hosted_thread_route.account_lookup_key` plus its query index, so a successful predeploy migration remains compatible with the previously deployed application if a later build step fails. Do not drop `hosted_linq_line.active_member_limit` in this rollout.

   The guarded line sync backfills current env-configured lines and verifies at least one configured assignable DB line exists before DB-backed assignment code serves traffic. Provider inventory sync stays on the explicit operator/contact-card path so production deploys do not depend on the Linq inventory API.

3. Any later user-authorized hosted or protected path must first run an
   aggregate-only dry run after the new application build is live. A nonzero
   `invalidRows` count means encrypted route material or its blinded lookup
   authority needs operator investigation; the backfill leaves those rows null
   and readiness incomplete.

4. Before apply, the authorized path must freeze rollbacks, prove the
   production alias points at the replacement build, wait
   `HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS`, and prove the alias again. If
   the alias changes, it must restart the full drain against the selected
   compatible build. Applying before this point is unsafe because an in-flight
   previous function can still create a null projection after a batch has
   passed it.

5. The authorized path must apply bounded, idempotent batches until
   `remainingRows` reaches zero. Each write rechecks the legacy row's null
   projection, channel, container, encrypted route value, lookup keys, and
   `updated_at`, so concurrent canonical refresh wins instead of being
   overwritten.

6. The authorized path must finish with the count-only readiness check.
   Readiness remains incomplete while any Linq or Telegram route is
   unprojected. Assignment remains available during backfill; it surfaces
   incomplete coverage and applies the same conservative unknown group weight
   to every candidate rather than attributing a group to an owner line or
   claiming exact spare capacity.

7. An explicit operator repair, provider inventory sync, or one-off line
   cutover that requires production credentials follows the same stop boundary.
   Discuss its operation and execution owner with the user before beginning.

8. Confirm each assignable line row has:

   - `configured_at IS NOT NULL`
   - `phone_number_encrypted IS NOT NULL`
   - `egress_policy = 'enabled'`
   - `health_status IN ('healthy', 'unknown')`

9. Configure per-line proactive warmup caps directly on `hosted_linq_line` only
   through a separately authorized production execution path.

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

Current application code no longer parses
`HOSTED_ONBOARDING_LINQ_MAX_ACTIVE_MEMBERS_PER_PHONE_NUMBER`, writes
`active_member_limit`, or includes the field in its generated Prisma client.
Weighted planning and the separate proactive new-conversation quota retain their
existing owners and behavior.

The postdeploy contract migration
`20260910180000_drop_linq_active_member_limit` drops the retired nullable
`hosted_linq_line.active_member_limit` column. Keep this migration out of `main`
until every gate below is satisfied: merging it admits automatic execution by
`hosted-web-contract-migrations.yml` after the replacement deployment. The
preceding code release retains the column for older Web builds and operator
scripts, including Prisma whole-row upserts that select the field implicitly.
The pre-merge gates are all of the following:

1. The replacement Web build and Prisma client are deployed, and the production
   alias is proven before and after the configured prior-function drain.
2. Older operator invocations, including line sync and provider-inventory
   scripts, have finished and cannot restart from a pre-cleanup checkout.
3. Any deployment-pinned Workflow capable of reaching an old line-store read
   or write has settled; elapsed HTTP route lifetime alone is insufficient.
4. Rollback admission excludes every Web build or CLI artifact that still
   references the column. The postdeploy contract lane may then apply the
   physical drop without changing weighted planning or proactive quotas.

The automatic contract lane proves deployment provenance and HTTP drain; it
does not attest operator CLI completion, prevent an old checkout from being
run, or settle a deployment-pinned Workflow. Establish those separate gates
before admitting this migration to `main`; a draft PR is not deployment proof.
After the lane applies it, verify the column is absent and ordinary configured
sync, provider inventory, and weighted/sticky routing succeed.

Before the physical drop, the code release can be reverted while retaining the
column. After the drop, recovery is a forward deployment of the replacement or
later compatible code; restoring an older generated Prisma client is unsafe.

## Contact Cards

Run or keep the existing contact-card reconciliation path enabled after line changes. Every configured or provider-discovered line should have the shared Murph name and phone contact card set up before meaningful outbound use.

## Logging

Do not log raw line phone numbers, thread ids, member ids, account lookup keys, plaintext, or ciphertext from scripts, provider sync, or migration checks. Use phone hints, aggregate counts, or provider ids for operator evidence.

## Draining automatic assignments

`HostedLinqLine.assignmentWeight = 0` removes a configured line from automatic
home-line and healthy proactive pools. Positive weights retain their tie-break
meaning; neither a preferred line nor capacity fallback can revive a zero-weight
candidate. Proactive capacity claims recheck positive weight after selection.
Configuration and provider inventory sync preserve this operator-owned weight.

The authenticated ops endpoint `GET /api/ops/linq-line-assignment` returns a
bounded configured-line inventory containing only hints, lookup keys, and
weights. From an existing ops session, POST to the same endpoint with
`{ "phoneNumberLookupKey": "<LINE_LOOKUP_KEY>", "assignmentWeight": 0 }` to
exclude a line; read it back and verify the retained line is still healthy and
eligible. The POST requires the existing same-origin mutation guard. Restore
the prior positive weight to undo the setting. The endpoint can exclude every
line, so verify the retained pool before changing settings.

This is automatic placement control, not line cancellation: existing direct
and group routes, replies, contact cards, and provider-attested managed inbound
relationship binding remain valid. An already-contacted line can still own that
inbound relationship. It does not migrate members or send announcements.
Deploy this reader everywhere before zeroing any weights; older readers can
still select zero-weight lines. Restore positive weights before reverting to an
older reader. Existing in-flight work is not canceled by the setting.
