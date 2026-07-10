# Retire Proven Hosted Deploy-Skew Compatibility

Status: completed
Updated: 2026-07-10

## Goal

Delete hosted web/Worker/runner compatibility branches only where deployed
bundle evidence, aggregate production observations, and persisted-state checks
prove the legacy producer or consumer can no longer exist. Remove each protocol
slice end to end: writer, parser, type, route, export, docs, and tests.

## Accepted scope

- Browser-vault legacy source-hash/dashboard replica bundle.
- No-op Linq contact-card callback and Worker allowlist entry.
- Dead active-runtime write-fence validation RPC and its query-only projection.
- Retired runtime log codes and the legacy accepted-attempt failure normalizer.
- Stale provider-authorization documentation tied to the removed RPC.

## Production proof

- The current Cloudflare revision was deployed with immediate container rollout
  at 100% traffic. Managed-container smoke matched the deployed runner bundle.
- More than six hours of post-deploy aggregate telemetry recorded 121 current
  browser-vault publishes and zero legacy contact-card forwards while other
  web-control operations remained active.
- Current provider traffic used runner-scoped signed credentials or provider
  tokens. The active-runtime validation RPC has no production source caller.
- Aggregate production database queries found zero rows for the retired
  continuity/reconnect log codes and zero legacy failure-summary shapes for the
  still-current accepted-attempt failure event.
- The minimum supported Cloudflare rollback floor for these web-facing cuts is
  revision `bf9aef7ffabd`.

## Gates and exclusions

- Do not delete persisted snapshot, mailbox, routing, billing, vault, or Durable
  Object readers without an explicit zero-count/backfill proof.
- Exclude mailbox fetch/cursor work because an active ledger row owns that path.
- Exclude `runner-container.ts` while the active runner-destroy lane owns it.
- Exclude webhook-transport compatibility while its active review-fix lane owns it.
- Defer Durable Object schema/null-name fallbacks because active traffic cannot
  census dormant objects.
- Defer mailbox, cron, Linq cleanup, display-name, Junction reconciliation, and
  assistant-session compatibility that the supplied vault or live rows still use
  or cannot prove absent globally.
- Preserve fail-closed rejection guards and current public status fields.
- No replacement feature flags, state, queues, or compatibility managers.

## Verification

- Record sanitized deployment/log/database/vault evidence for each accepted cut.
- Run focused caller/stale-string searches and `pnpm test:diff` for touched owners.
- Run required security/privacy and coverage-write audits.
- Parent final call-path review, PR ReviewGPT loop, and CI on the pushed head.

## State

- Done: implemented the accepted deletion set with no replacement abstraction.
- Done: security/privacy review found no trust-boundary or dormant-state
  regression. Exact write-fence, signed credential, token, schema, and migration
  paths remain fail closed.
- Done: coverage-write review added direct rejection proof for the retired
  source-hash field, contact-card callback, and runtime log codes. Focused web,
  Cloudflare, and hosted-execution tests and typechecks pass.
- Now: archive and commit the old-base diff, rebase it onto the current hosted
  shutdown/finalization changes, and preserve both protocols through any overlap.
- Next: rerun routed verification and security review on the rebased head, then
  push, open a draft PR, and complete ReviewGPT/CI.
Completed: 2026-07-10
