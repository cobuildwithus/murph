# VaultShare v0 — consented vault projections delivered to a destination member

Status: completed
Created: 2026-06-10
Updated: 2026-06-10

## Goal

A member grants a standing share of a fixed vault projection to a destination member; the
grantor's hosted runtime projects the consented slice from its own vault and delivers it into
the destination member's mailbox through the existing signed callback channel. First
projection kind: `sleep-times.v0` (per-night bed/wake timestamps). First consumer: a
manually created referee member for a family sleep-consistency challenge; the destination
assistant reads deliveries as ordinary mailbox context.

Design rules:
- Consent is a row (grantor, kind, destination, status), not an encoded string.
- Shares are defined over canonical vault data (query projections), not a producer pipe.
- Delivery payloads ride the existing encrypted mailbox path; grants hold no payload. The
  only delivery-specific plaintext-at-rest columns are mailbox envelope metadata: the
  dedupe key (share id + night date) and `occurred_at`, parser-pinned to the night date at
  UTC midnight so exact sleep timestamps never land in Postgres (follow-up to PR #104,
  which originally stored the wake timestamp as `occurred_at`). Standard envelope columns
  (kind, lane, destination user id, created_at) additionally reveal that and when a
  delivery happened — not when sleep occurred.
- Destination is a member; future group containers consume the same deliveries unchanged.
- Projection and delivery are deterministic code; no assistant involvement on either side.

## Success criteria

- With an active grant, after the grantor runtime's next wake the destination mailbox holds
  one `vault-share.delivery` item per night with schema-valid `{date, sleepStartAt, sleepEndAt}`.
- Without an active grant (none, revoked, unknown destination, inactive destination), the
  delivery route appends nothing and returns the indistinguishable `no-active-share`
  response (no information leak about share configuration); regression tests cover each.
- Re-delivery of an already-delivered night is a dedupe no-op (no duplicate items).
- Projection/delivery failures never fail the runtime wake (fail-open, logged without payload).
- Members with no sleep data make no delivery calls.
- No plaintext sleep timestamps added to Postgres (envelope metadata limited to ids plus
  the night date); no new env vars; no new external surface.

## Scope

In scope:
- Prisma migration: `hosted_vault_share` table + `HostedVaultShare` model.
- `sleep-times.v0` payload schema + parser (packages/hosted-execution, alongside existing
  mailbox parsers) and mailbox kind/lane registration (`vault-share.delivery` → system lane).
- Web route `POST /api/internal/hosted-runtime/vault-share/deliver`: callback-auth (grantor
  identity from `requireHostedCloudflareCallbackRequest`), grant check, destination active-
  access check, zod validation, size cap, `appendHostedMailboxItem` + mailbox append signal.
- Worker: route constant, egress allowlist entry, `vault-share-port` (clone of log-port
  pattern), platform wiring.
- Runtime: `vaultSharePort` platform contract + deterministic projection step after the
  foreground pass (read `summarizeWearableSleepRuntime(vaultRoot)`, last 3 nights, offer
  delivery; web is the authority on whether shares exist).
- Tests: route auth/grant/validation/dedupe; projection unit (vault fixture → payload);
  worker policy; kind/lane registry.
- Operator runbook (in this plan): create referee member, grant/revoke SQL + consent events.

Out of scope (v1+ fights this list):
- Group-chat consent capture, any UI, channel routing for group threads.
- Destination-side promotion of deliveries into canonical vault records.
- Additional projection kinds, multi-destination fan-out, share discovery APIs.
- Backfill of nights before the grant (3-night projection window self-heals short gaps).
- Updating an already-delivered night after provider re-scoring (dedupe wins; documented).

## Constraints

- SECURITY: first cross-member data path. Single choke point: only the deliver route may
  append cross-member; it fails closed (no grant/inactive/oversized/schema-invalid → refuse).
  Grantor identity comes only from callback auth; destination only from the validated body.
  Logs carry ids/kind/decision, never timestamps or payload fields.
- RELIABILITY: delivery is best-effort per wake; idempotent via mailbox dedupeKey
  `vault-share:{shareId}:{date}`; no retry loops in-container (next wake retries naturally);
  foreground user work is never blocked (step runs after the pass, fail-open).
- Persisted-state placement: grants are canonical Postgres truth; deliveries live only in
  existing encrypted mailbox storage; nothing starts in `.runtime/` state.
- Tandem deploy: Worker policy entry + web route ship together; runtime step fails open if
  either predates it. Do not seed grants until both are live.

## Risks and mitigations

1. Risk: runtime wake cadence delays deliveries (no wake → no share).
   Mitigation: acceptable for v0 (overnight syncs wake runtimes); referee chat usage also
   wakes the grantor path indirectly via normal product use; documented.
2. Risk: route becomes a generic cross-member write surface.
   Mitigation: kind is hardcoded server-side; payload schema closed; one item per night;
   size cap; grant must match (grantor, kind, destination) exactly.
3. Risk: scope creep toward group containers.
   Mitigation: out-of-scope list above; destination is just a memberId string column.

## Tasks

1. Migration + Prisma model (`hosted_vault_share`).
2. hosted-execution: payload schema/parser, route constant, mailbox kind + lane mapping.
3. apps/web: deliver route + grant store helper + tests.
4. apps/cloudflare: policy entry + vault-share port + platform wiring + policy test.
5. assistant-runtime: platform contract + projection step + tests.
6. Verification (below), security/coverage/final audits, finish-task, PR.

## Decisions

- Idempotency key is the night `date` (one summary night per date from the wearable
  projection), not raw provider record ids — simpler and provider-agnostic.
- One mailbox item per (share, night); 3-night window per wake self-heals gaps.
- Deliveries land in the `system` lane (no AI-usage gate coupling); destination assistant
  reads them as context on its next wake.
- Container offers deliveries unconditionally when local sleep data exists; web answers
  `noActiveShare` cheaply — container holds no share state (single source of truth).

## Verification

- `pnpm typecheck` — PASS (workspace package/app typecheck).
- `pnpm test:diff` — PASS (exit 0). Diff scope owners: apps/cloudflare, apps/web,
  packages/assistant-runtime, packages/hosted-execution; expanded to 11 affected
  packages/apps including `apps/web verify` (next build + lint) and
  `apps/cloudflare verify` (typecheck + Node + Workers lanes).
- Suites: hosted-execution 158/158 (incl. new vault-share contract + wake round-trip
  tests and consciously updated freeze tests); assistant-runtime 820 passed (incl. new
  projection/import tests); apps/web 2254/2254 (incl. new deliver-route auth/grant/
  dedupe/no-leak tests and consciously updated privacy-seam guards); cloudflare lane
  incl. new web-control policy test.
- Deliver-route refusal semantics: missing grant, revoked grant, and inactive
  destination all return the indistinguishable `no-active-share` response with nothing
  appended (tested).

## Operator runbook (v0 live setup)

1. Deploy web + cloudflare together; confirm `/api/internal/hosted-runtime/vault-share/deliver`
   refuses unauthenticated calls.
2. Create referee member via normal invite flow (spare email; web/telegram channel).
3. After explicit verbal consent in the group chat, per grantor:
   `INSERT INTO hosted_vault_share (id, grantor_member_id, projection_kind,
    destination_member_id, status, source, granted_at, updated_at) VALUES
    (<cuid>, '<grantor>', 'sleep-times.v0', '<referee>', 'granted',
     'operator-recorded-verbal', now(), now());`
   plus a `hosted_consent_event` row (scope `vault-share:sleep-times.v0:<referee>`,
   action `granted`, source `operator-recorded-verbal`).
   `updated_at` is required: the column is NOT NULL with no database default (Prisma's
   `@updatedAt` only fills it on Prisma-client writes, not raw SQL).
4. Revoke: `UPDATE hosted_vault_share SET status='revoked', revoked_at=now(),
   updated_at=now() WHERE ...;` plus matching consent event.
   Re-grant is an UPDATE back to `status='granted'` (with `revoked_at=NULL,
   updated_at=now()`), never a second INSERT: the unique index on
   (grantor, kind, destination) allows only one row per share.
5. Verify after next overnight wake: referee assistant can state each grantor's bed/wake
   times; spot-check no plaintext payloads in `hosted_mailbox_item`.
Completed: 2026-06-10
