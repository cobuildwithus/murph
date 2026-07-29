# PR 932 ReviewGPT Round 12 Remediation

Status: completed

## Goal

Keep the originating signup-link webhook retryable until its reclaimable
pre-provider delivery attempt can continue, while ensuring one provider
idempotency key never changes its persisted group intent.

## Proven gaps

- A prompt retry inside the 15-minute ambiguity window receives
  `notice_in_flight`, but the webhook service currently acknowledges it with
  HTTP 202. No continuation remains to retry after the row becomes stale.
- Stale reclaim updates the existing delivery row from the newly planned
  side effect. A later same-day inbound can therefore reuse one provider key
  with a different group source and payload.

## Decision

`HostedLinqDelivery` remains the only attempt owner. A fresh in-flight signup
attempt returns its existing stale deadline through the drain; the webhook
service raises a retryable response so the exact provider webhook remains the
continuation owner. Signup claim intent is immutable for one provider key. A
replay of the exact source event may reconstruct and revalidate its persisted
group context, while a different inbound cannot reclaim that key.

## Scope

- hosted Linq delivery claim, transport, webhook service, and group-outreach
  reply authority
- signup source-reference codec
- focused route/unit tests and the real-PostgreSQL crash/retry proof
- durable iMessage delivery guidance and PR evidence

## Invariants

- A committed conversational input is not acknowledged until its required
  signup effect sends or reaches a decided terminal outcome.
- One provider idempotency key names one immutable template, target, and group
  reply context.
- Only the exact original webhook can recover a persisted group-aware attempt.
- Accepted delivery consumes the exact originating outreach once.
- No scheduler, queue, new table, or second persistence owner.

## Verification

- focused delivery-store, transport, service/route, idempotency, and dispatch
  tests: 301 passed
- production-faithful PostgreSQL crash/retry lifecycle: 1 passed
- Web typecheck and lint: passed (lint retained only known unrelated warnings)
- `pnpm test:diff apps/web`: passed (520 files passed, 13 skipped; 6,647
  tests passed, 173 skipped)
- `pnpm verify:acceptance`: passed, including all package coverage, Web
  production build, and Cloudflare worker verification
- exact-head ReviewGPT continuation and CI remain the PR completion gate after
  this implementation commit

Updated: 2026-07-26
Completed: 2026-07-26
