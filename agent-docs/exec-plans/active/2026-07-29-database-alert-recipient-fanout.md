# Fan out database health alerts to two direct chats

Status: active

Date: 2026-07-29

## Goal

Deliver each admitted database health alert to both configured direct Linq chats,
while preserving the existing global thirty-minute admission fence and avoiding
group-chat creation or duplicate recipient-visible messages.

## Invariants

- One database-alert cycle may be admitted globally at most once every thirty
  minutes.
- Each admitted cycle targets two separate existing direct chats. It must never
  create or address a group chat.
- Each destination uses its own stable provider idempotency key.
- One unhealthy destination must not prevent an independent attempt to the
  healthy destination.
- A partially failed cycle remains pending for a later admitted retry. Replaying
  a completed destination is safe because its idempotency key remains stable.
- Destination identifiers and credentials stay in protected runtime secrets and
  never enter source, documentation, logs, test fixtures, or review artifacts.
- The existing primary-chat secret remains the rollback-compatible source for
  the first destination.
- Line-health checks continue to fail closed before every destination send.
- After production deployment, send exactly one link-free, reply-oriented
  confirmation to each existing direct chat.

## Implementation plan

1. Add one protected secondary direct-chat secret to the Cloudflare environment
   contract, deployment preflight, runtime configuration, and operator docs.
2. Change the alert sender to run the two direct-chat sends independently with
   destination-specific idempotency keys and aggregate completion only after
   both settle.
3. Extend unit and hosted-runtime tests for successful fan-out, partial failure,
   retry timing, idempotency, line health, and duplicate configuration.
4. Run focused local verification, the required preliminary specialist and
   product-experience reviews, final parent review, and the exact-head
   ReviewGPT/CI gate.
5. Install the production secret, deploy the Cloudflare worker, verify the
   deployment and a natural cron, then send and verify one confirmation message
   per direct chat.

## Verification

- Focused Cloudflare database-health unit tests.
- Focused deploy-preflight and hosted-runtime tests.
- Cloudflare typecheck.
- Canonical diff verification and acceptance verification.
- Exact-head CI and required ReviewGPT rounds.
- Production deployment status plus a natural scheduled-run observation.
- Provider responses confirming one separate confirmation send per direct chat,
  without printing message contents, destination identifiers, or credentials.

## Deployment

This is a Cloudflare-only runtime change. Add the secondary protected secret
before deploying so the new worker fails closed rather than starting with an
incomplete recipient set. Deploy the worker, observe a natural scheduled run,
then perform the separately authorized confirmation sends.
