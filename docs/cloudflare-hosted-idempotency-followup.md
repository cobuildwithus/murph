# Cloudflare Hosted Execution Idempotency Follow-Up

Status snapshot: 2026-04-27

The hosted hard cut removes the old web-owned run/cursor recovery protocol.
Idempotency now follows the owner of each durable fact:

- `apps/web` dedupes inbound producer work at mailbox append time with
  per-user dedupe keys and mailbox payload hashes.
- `apps/web` keeps hosted workspace checkpoint metadata, runtime status, and
  runtime logs as the queryable hosted execution truth.
- `apps/cloudflare` keeps only runner-local coordination state needed to avoid
  concurrent container passes for the same user.
- `@murphai/assistant-runtime` owns mailbox import cursors, outbox/inbox
  semantics, timers, and side-effect recovery inside the encrypted workspace
  checkpoint.

## Standard Rule

For new hosted outward effects:

1. Persist the owning product fact or runtime checkpoint before sending.
2. Record enough redacted runtime log/status detail for operator debugging.
3. Let the runtime decide retry/reconciliation from its checkpoint state.
4. Keep Cloudflare as the caller of that runtime, not as a second durable queue
   or cursor owner.

When an upstream transport cannot provide strong idempotency, keep the residual
"send succeeded but durable marker failed" edge explicit in the owning runtime
or product journal. Do not reintroduce a Cloudflare-specific run adoption or
finalization ledger to hide that edge.
