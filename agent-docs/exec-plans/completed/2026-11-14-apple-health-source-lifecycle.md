# Apple Health source lifecycle fixes

Status: completed
Created: 2026-11-14
Updated: 2026-11-14

## Goal

- Stop three server bugs on the phone health path found by an audit on
  2026-11-13:
  - A. An explicit companion `connect` closed the Apple Health source whatever
    the platform, and the runner dropped data already accepted for a closed
    source.
  - B. A Junction summary record whose inline JSON passed 32,768 characters
    could never be admitted.
  - C. The unscoped companion status read counted a finished history pull as
    received data.

## Success criteria

- An Android sign-in never touches the Apple Health source, and an iOS sign-in
  never touches Health Connect.
- Signing a phone back in leaves a connected, unfenced source as it was.
- Data a webhook already accepted for a source whose reconnect is open imports
  once the source is re-admitted, and stops waiting on a fixed budget.
- An oversized summary record becomes a window fetch instead of a 500.
- The unscoped status read ignores data-less history completions.
- Each fix has a test that fails without it.

## Product UX

- Effort: Patch. It restores the existing promise that phone health data keeps
  arriving.
- Outcome: a member who signs the app back in keeps their synced data and
  status; an Android member's sign-in leaves Apple Health alone.
- Reaches: iOS and Android companion members with a Junction connection. Web
  wearable connects are unchanged.
- Proof: the route, lifecycle, runner and Postgres tests under Verification.

## Scope

- In scope: `apps/web/src/lib/device-sync` connect and status reads, the two
  runner import gates and the webhook job builder in
  `packages/device-syncd/src/providers/junction.ts`, and
  `packages/device-syncd/src/prepared-webhook.ts`.
- Out of scope: `junction-client.ts`, the importer path lists and the
  `junction.ts` region another lane is changing; any write to production; a
  Health Connect connect route.

## Constraints

- Technical constraints: the device webhook queue retries a held webhook for
  about 76 minutes and then dead-letters it, so a runner hold must end well
  inside that.
- Product/process constraints: no production writes; no member data in the
  repository or the PR.

## Risks and mitigations

1. Risk: keeping a connected source's epoch on `connect` leaves history
   coverage recorded for the old registration.
   Mitigation: disconnecting the source and connecting again still opens a new
   epoch and re-reads history. See Decisions.
2. Risk: a held job fails retryably and marks the account's last sync failed
   until it succeeds or ends.
   Mitigation: only webhook-accepted work is held, on the ordinary five-attempt
   budget. Scheduled reads for a pending source still complete without work.

## Tasks

1. Verify each bug in code. Done; see Decisions.
2. B: ask whether an inline record fits the prepared event before building its
   job; fall back to the window fetch.
3. C: skip data-less history completions in the unscoped status read.
4. A: pass the calling platform's source to explicit connect; keep a connected
   source's epoch; hold accepted webhook work at both runner gates.
5. Update `ARCHITECTURE.md` and `packages/device-syncd/README.md`.

## Decisions

- **A, what was verified.** `createSdkSignInSession` passed the Apple Health
  slug for every `connect`. `beginHostedDeviceSyncConnectionSourceReconnect`
  wrote `disconnected` with no error and cleared `lastDataAt`. Both runner
  gates returned `{}` for a source that is not admitted, so the job succeeded
  and its payload was acknowledged. Runtime source projection treats any update
  to a disconnected Junction source as stale, so only a webhook or callback
  admission can reconnect one.
- **A, a data webhook already re-admits a closed source.** A source that is
  disconnected with no error is re-admitted by the next data webhook received
  after it closed, once Junction's live provider list shows it connected. That
  path existed and is covered by the Postgres authority proof; no second
  re-admission path was added. A webhook received before the close keeps
  retrying on the queue until the source is back or the queue dead-letters it.
- **A, `connect` keeps a connected source's epoch.** The close was added on
  2026-08-15 so the registration webhook after a reconnect would advance the
  epoch and reopen schedule-time history coverage. What depends on the close:
  that coverage reset and the full history re-read behind it, and the scoped
  status read hiding receipts older than the close. Neither is needed when the
  source is healthy: the member is signing the same phone health source back
  in. The close cost a whole-history re-read on every sign-in and opened the
  window in which accepted data was dropped. A source that is not connected,
  or is fenced, still opens a pending epoch on `connect`.
- **A, the runner hold.** A webhook-accepted job (its payload carries a data
  `eventType`) whose source is disconnected with no error now fails with
  retryable `JUNCTION_SOURCE_ADMISSION_PENDING`. The ordinary job budget bounds
  it: five attempts over 36 minutes 15 seconds, then the job is dead and its
  payload is acknowledged. A fenced source still drops its work at once. No new
  retry owner, counter or state was added.
- **B.** The cap is a decoder limit, so the provider checks the inline string
  with `fitsPreparedDeviceSyncWebhookInlineString` (characters, plus serialized
  bytes with room left for the rest of the event) and emits the existing
  window-fetch job when it does not fit.
- **B, a stale provider test.** One provider test asked webhook preparation to
  keep a 64,001-character record inline. No ingress path has admitted that job
  since prepared events capped strings; it was the bug stated as a test. It now
  uses a large record that fits. A queued job that already carries a large
  record still imports it inline, and the runner has no size cap of its own.
- **C.** A history completion carries no data source, which is why the scoped
  read never matched it. The unscoped read now skips a `historical.data.*`
  signal with no source. iOS builds before the scoped call used the unscoped
  read to decide whether Apple Health had been set up and to show the last
  receipt; they now see no receipt where only a completion existed, which is
  the true state. A member in that state taps Connect again.
- **Production state was not read in this task.** The audit's counts are taken
  as reported. The repair below is for the owner to run and approve.

## Stranded source repair (owner approval required, not run)

Read-only query that finds Apple Health sources left closed with no error on a
live connection, with what has arrived since:

```sql
SELECT
  s.id AS source_id,
  s.connection_id,
  s.lifecycle_epoch,
  s.first_seen_at,
  s.last_seen_at AS closed_at,
  s.last_data_at,
  c.connected_at,
  c.last_webhook_at,
  (
    SELECT string_agg(
      o.source_provider_slug || '=' || o.status
        || coalesce('/' || o.last_error_code, ''),
      ', ' ORDER BY o.source_provider_slug
    )
    FROM device_connection_source o
    WHERE o.connection_id = s.connection_id AND o.id <> s.id
  ) AS other_sources,
  (
    SELECT count(*)
    FROM device_webhook_trace t
    WHERE t.provider = 'junction'
      AND t.provider_account_blind_index = c.provider_account_blind_index
      AND t.received_at > s.last_seen_at
      AND (t.event_type LIKE 'daily.data.%' OR t.event_type LIKE 'historical.data.%')
  ) AS data_webhooks_since_close,
  (
    SELECT string_agg(DISTINCT coalesce(g.source_provider_slug, '(none)'), ', ')
    FROM device_sync_signal g
    WHERE g.connection_id = s.connection_id
      AND g.kind = 'webhook_hint'
      AND g.created_at > s.last_seen_at
  ) AS receipt_sources_since_close
FROM device_connection_source s
JOIN device_connection c ON c.id = s.connection_id
WHERE c.provider = 'junction'
  AND c.status = 'active'
  AND s.source_provider_slug IN ('apple_health_kit', 'apple_health', 'apple_healthkit')
  AND s.status = 'disconnected'
  AND s.last_error_code IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM device_connection_source newer
    WHERE newer.connection_id = s.connection_id
      AND newer.id <> s.id
      AND newer.source_provider_slug IN ('apple_health_kit', 'apple_health', 'apple_healthkit')
      AND coalesce(newer.lifecycle_epoch, 1) >= coalesce(s.lifecycle_epoch, 1)
      AND newer.status <> 'disconnected'
  )
ORDER BY s.last_seen_at;
```

Repair, by what the row shows:

- **The member uses Android** (`other_sources` or `receipt_sources_since_close`
  names `health_connect`, or the row never had data): the Apple Health row was
  made by the Android sign-in. Delete that one row, guarded on the state the
  query returned (`status = 'disconnected'`, `last_error_code IS NULL`, the
  same `last_seen_at`), expecting exactly one row. If the connection has no
  `health_connect` source and data webhooks arrived with no receipt, the member
  taps Connect Health Connect once after the Web deploy; that opens the pending
  epoch the next webhook admits.
- **The member uses an iPhone:** no SQL. After the Web deploy the member taps
  Connect Apple Health once. The next Apple Health webhook re-admits the source
  at a new epoch and re-reads history, which brings back the days it was
  closed. If it stays closed, Junction no longer lists Apple Health as
  connected for that user and the same tap re-registers it.

## Verification

- Commands to run:
  - `pnpm --dir packages/device-syncd exec vitest run test/junction-provider-webhooks.test.ts test/service.test.ts`
  - `pnpm --dir apps/web exec vitest run test/device-sync-hosted-wake.test.ts test/device-sync-companion-routes.test.ts test/device-sync-companion-signup-route.test.ts test/lapsed-member-product-access.test.ts`
  - `MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-prepared-webhook-authority-postgres.test.ts`
    against a migrated loopback test database
  - `pnpm --dir packages/device-syncd typecheck`, `pnpm --dir apps/web typecheck`
  - `pnpm test:diff` over the touched paths
- Expected outcomes: all pass. Each new test was run once against the unfixed
  code and failed there.

## Deployment

- B and C are Web only.
- A is Web (connect) plus the Cloudflare runtime (the runner hold). Either
  order is safe: the two halves share no contract. Web deploys on merge and
  stops healthy sources being closed; the runtime deploy then makes the runner
  hold work for the closes that remain (a reconnect from an error state, or a
  browser Link restart).
Completed: 2026-11-14
