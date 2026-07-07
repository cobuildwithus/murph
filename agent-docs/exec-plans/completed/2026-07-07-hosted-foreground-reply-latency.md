# Hosted Foreground Reply Latency

Status: completed
Updated: 2026-07-07

## Why

Production traces for a simple foreground Linq reply showed the model result
and queued delivery intent were ready within a few seconds, while the
user-visible send waited for the hosted automation pass to finish. The pass
currently performs wake/cron projection before the foreground delivery phase can
drain the prepared delivery.

Foreground reply priority is already a hosted-runtime invariant: maintenance,
cron, device sync, and idle bookkeeping must not block a fresh user message once
the reply is ready.

## Scope

- Keep the existing delivery-intent/idempotency path.
- Let foreground hosted replies send before cron or next-wake bookkeeping that
  is not required for the reply itself.
- Add metadata-only timing observability around the post-scan pass tail so future
  incidents can identify which pass segment is slow.
- Avoid mailbox schema/import changes owned by the active consumed-at lane.

## Verification

- `pnpm --dir packages/assistant-engine test:coverage` passed.
- `pnpm --dir packages/assistant-runtime test:coverage` passed.
- `pnpm typecheck` passed.
- `pnpm test:diff ...` was attempted and blocked by an unrelated reproducible
  CLI intervention test failure outside this task's working set.
- Parent final review of the changed ordering and redacted observability fields.

## Deployment Notes

This change is runner-bundle/runtime behavior only. Web and Cloudflare protocol
contracts do not change. During gradual rollout, old warm runners may still wait
for the old pass tail until recycled.
Completed: 2026-07-07
