# Vercel failure recovery and diagnostics

Status: completed
Created: 2026-09-29
Updated: 2026-09-29

## Outcome and protected invariants

Recover one transient device-webhook enqueue failure and preserve safe diagnostics
for SMS provider rejection and best-effort wake timing failures. Authentication,
canonical device acceptance, durable wake ownership and privacy retain their
existing owners. Stale runtime ownership is explicitly excluded.

## Evidence and scope

The existing queue sender makes one request and returns retryable 503 on transport
failure. Canonical prepared-event admission already deduplicates replay. Reuse the
same sealed envelope for one network-failure retry; do not reverify, reseal or fall
back to synchronous acceptance. HTTP, parse, cancellation and timeout failures
retain their existing handling.

The SMS adapter discards every provider status/code and replaces internal failures
with one indistinguishable exception. Preserve fixed stages and bounded numeric
metadata in a synthetic server-only cause; retain generic public errors, exact
provider binding, ten-second request deadlines and no automatic SMS retries.

The timing writer logs the Prisma class but loses its code. Include that code
without exception prose, metadata or SQL; diagnostic failures remain best effort.

No production rows, private logs or identifiers are stored here. Production
configuration and provider credentials are outside this local implementation.

## Architecture and failure behavior

Existing owners: Web queue enqueue, Twilio Verify adapter, wake timing logger.
No new persistence, dependencies, scheduler, shared retry layer or authority.
Queue retry adds at most one configured-timeout control request only after fetch
fails. A lost response can duplicate transport, so the exact same envelope is
reused and existing canonical deduplication remains mandatory. Persistent failure
returns the existing retryable response for provider redelivery.

## Product UX

Outcome: recover transient webhook transport without duplicate canonical work.
Reaches: ordinary acceptance, lost acknowledgement, repeated failure and terminal
provider/control failures. SMS and login recovery behavior are unchanged.
Proof: real control-client enqueue with a synthetic lost reply, bounded-attempt
regressions, real HTTP error serialization and private diagnostic assertions.
No presentation changes; production delivery validation remains separate.

## Verification

- Web provider, admission, queue and wake tests: 73 passed across four files.
- Existing Cloudflare queue-consumer suite: 12 passed, including same-envelope
  duplicate coalescing and accepted/duplicate acknowledgement behavior.
- `pnpm --dir apps/web typecheck`: passed after preparing the existing importer
  package with `pnpm --dir packages/importers build`. The fresh-checkout TS2307
  prerequisite is recorded in the task-owned Frog entry.
- Focused ESLint: passed for all six modified source/test files.
- `pnpm complexity:diff`: passed; no function exceeds 20. Twilio maximum fell
  from 16 to 15 by removing its blanket exception rewrite.
- Parent review: same-envelope replay, unchanged authentication/public responses,
  bounded numeric-only diagnostics, no sensitive diff content, unchanged runtime
  owner behavior and no new state. Product UX: Ready for the tested local scope.
- Docs drift initially required the index entry; the owner references were added.
- Production delivery, deployment, remote CI and final external review are not
  claimed by this local fix. SMS rejection and the original Prisma failure remain
  unresolved until provider-side evidence or the new diagnostics are available.

## Deployment

Web-only change; current Worker accepts the unchanged encrypted envelope/schema.
No migration or rollout order dependency. Rollback restores one enqueue attempt.
Production OTP cause and the isolated Prisma failure need newly emitted diagnostics
or provider-side evidence; local tests cannot establish their historical cause.

## Changelog

Internal transport recovery and operational diagnostics; no new member-facing
feature, setting, permission or UI. No changelog entry.
Completed: 2026-09-29
