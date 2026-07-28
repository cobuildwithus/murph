# PlanetScale database health alerts

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Keep a bounded five-minute history of the production PlanetScale branch's
  database-connection health outside Postgres itself.
- Page the existing operator Linq chat when database connection health becomes
  materially unsafe, with no provider attempt more often than once every 30
  minutes and concise rotating copy.

## Success criteria

- A Cloudflare Cron Trigger calls one singleton SQLite-backed Durable Object
  every five minutes, so monitoring and alert state survive a Postgres outage.
- Each run stores either a normalized PlanetScale Prometheus sample or a
  classified scrape failure and prunes rows older than 30 days.
- Samples cover PgBouncer oldest-client wait, primary branch-local server
  connections versus Postgres capacity, PgBouncer server-pool states, Postgres
  connection states, and direct-port connection-error counter deltas.
- Alerts fire for a five-second PgBouncer wait, 90% branch-local server-pool or
  Postgres connection utilization, abnormal Postgres connection states, any
  new direct-port connection error, or two consecutive monitoring failures.
- Durable admission records every provider attempt before network egress and
  enforces a global 30-minute minimum. An ambiguous retry reuses the exact
  message and Linq idempotency key.
- Alert messages cycle through a fixed bank of materially distinct short
  openings and append current metric evidence plus the actual UTC check time.
- Linq message egress requires a healthy configured direct chat and healthy
  current line, fails closed when delivery health is indeterminate, and uses
  provider-owned no-`from` line selection after admission.
- The existing hosted-runtime latency email monitor remains unchanged and
  never falls back to Linq.

## Scope

- In scope:
  - PlanetScale HTTP service discovery and a bounded Prometheus text parser.
  - Cloudflare Worker cron, Durable Object persistence, health evaluation, and
    direct Linq delivery to the recipient anchored by one preconfigured operator
    chat.
  - Deploy configuration, secret/variable contracts, focused tests, and
    architecture/security/reliability/runbook documentation.
- Out of scope:
  - A dashboard or public/queryable metric API.
  - User-facing product messages, arbitrary recipient discovery, app-owned line
    or chat selection, recovery messages, or changes to interactive Linq
    delivery.
  - Changes to database retry policy, pool sizing, or the latency email alert.

## Constraints

- Technical constraints:
  - The alert owner cannot depend on the database it monitors.
  - PlanetScale and Linq credentials remain Worker-only secrets and are never
    forwarded to runner containers or included in logs.
  - Scrapes accept only the authenticated PlanetScale HTTP-SD contract,
    HTTPS/443 targets, bounded response bodies and signed query values, and no
    redirects. The service credential is used only for discovery.
  - Port 5432 is the repository's migration-only direct endpoint. If another
    direct production client is introduced, the direct-admission signal must be
    split before that client ships.
- Product/process constraints:
  - No phone number is stored or logged; the recipient is derived transiently
    from an already-known healthy direct Linq chat.
  - Database pages have no quiet hours because they represent an explicitly
    requested critical operational alert.
  - Message variation carries real context and does not use random padding or
    meaningless synonym churn.

## Risks and mitigations

1. Risk: Postgres downtime prevents its own alert state from being read.
   Mitigation: own the monitor, history, and paging fence in Cloudflare Durable
   Object SQLite.
2. Risk: overlapping cron deliveries or ambiguous Linq responses duplicate
   pages.
   Mitigation: use one singleton object, a persisted run lease, a pre-egress
   attempt timestamp, and stable body-level Linq idempotency.
3. Risk: a transient provider scrape causes noisy paging.
   Mitigation: require two consecutive scrape/required-metric failures while
   retaining immediate paging for concrete unsafe metric samples.
4. Risk: authenticated service discovery returns an unsafe scrape locator.
   Mitigation: accept only bounded HTTPS targets without embedded credentials,
   non-default ports, or redirects; promote only bounded signed `__param_*`
   values into the scrape query.
5. Risk: counter resets look like new direct-port failures.
   Mitigation: compute positive per-series deltas and treat new or reset series
   as zero delta.
6. Risk: a flagged line silently drops the only operator page and repeated
   retries worsen its reputation.
   Mitigation: require healthy chat and current-line provider state before every
   message POST, retain suppressed alerts for a paced retry, and leave final line
   selection to Linq without a pinned `from`.

## Tasks

1. Add the database-health metric parser, evaluator, SQLite schema, monitor, and
   Linq sender.
2. Add the Durable Object export, namespace contract, cron handler, binding,
   SQLite migration, and five-minute trigger.
3. Cover parsing, persistence/retention, alert thresholds, failure hysteresis,
   recurrence pacing, copy rotation, idempotent retry, and cron dispatch.
4. Update architecture, security, reliability, Cloudflare deploy docs, and the
   testing map.
5. Run focused and canonical verification, completion specialists, product
   message review, final ReviewGPT/CI gate, then commit and open a PR.

## Decisions

- Use the existing Cloudflare execution plane rather than Web/Vercel because a
  Postgres-owned monitor cannot page during a database outage.
- Interpret "local server-pool saturation" as the production branch's
  pod-local PgBouncer server connections divided by that primary Postgres pod's
  `max_connections`; persist the detailed PgBouncer server-state gauges beside
  the derived ratio.
- Treat positive deltas of PlanetScale direct-port (5432)
  `connection_errors_total` as direct migration admission failures because
  repository production runtime traffic is required to use PgBouncer port
  6432 and the direct endpoint is migration-only.
- Page on provider attempts, not only acknowledged sends, for the 30-minute
  limit. This is the only interpretation that remains safe after an ambiguous
  provider response.

## Verification

- Commands to run:
  - Focused Cloudflare node tests for metric parsing, monitor state, Linq
    delivery, deploy config, and scheduled dispatch.
  - `pnpm --filter @murphai/cloudflare-runner typecheck`
  - `pnpm test:diff <changed paths>`
  - `pnpm verify:acceptance`
  - Required completion-specialist and final PR review gates.
- Expected outcomes:
  - All focused and canonical checks pass.
  - Generated and checked-in Wrangler configuration agree.
  - Review gates find no unresolved correctness, security/privacy,
    reliability, copy/deliverability, or missing-coverage issue.
