# SEV-0 hosted reply liveness recovery

## Goal

Restore timely, ordered hosted replies for direct and group Linq conversations
without weakening route authority or durable write-fence safety.

Success criteria:

- A foreground follow-up imported during reply delivery starts a new assistant
  pass before the idle checkpoint instead of waiting 180 seconds.
- An exact persisted direct inbound can authorize only its own reply after a
  stale live route, while group routes remain strict.
- Focused tests, typechecks, and required local audits pass on the exact commit
  before one coordinated production rollout.

## Constraints

- Preserve user-critical ingress, read receipts, typing, and reply delivery.
- Preserve strict member, thread, provider-message, mailbox, and directness
  checks; do not add a group fallback.
- Do not add persisted state, queues, timers, schedulers, or compatibility
  machinery.
- Preserve unrelated working-tree and coordination-ledger work.
- Do not record private identifiers, message contents, credentials, or local
  paths in committed artifacts.

## Evidence

- Production ingress, durable mailbox append, orchestration signal, and read
  receipt all succeeded for affected direct and group messages.
- A group action completed, then a same-thread follow-up returned roughly three
  minutes later and out of order; the runtime's configured idle checkpoint delay
  is exactly 180 seconds.
- The foreground watcher can stage a follow-up inside an
  `assistant_runtime_commit` pass, but the outer rerun gate excludes that
  checkpoint reason and services the due assistant wake only after checkpoint.
- Persisted prepared direct replies retain their answered mailbox item IDs, but
  retry-time route authorization currently sees only transient live wake context.
  A restart can therefore discard the exact direct-inbound proof and reject the
  later delivery with a route-authority 403.
- Production also shows a separate five-second runtime-wake timeout against an
  already-active long-running invocation. It remains under investigation and is
  intentionally outside this patch until its lifecycle owner is proven.

## Approach

1. Add a focused failing test for a late fresh input that exits with
   `assistant_runtime_commit` and would otherwise wait for idle checkpointing.
2. Delete the obsolete checkpoint-reason guard so the already-owned exact fresh
   assistant-input batch reruns immediately.
3. Revalidate persisted answered mailbox IDs server-side for exact direct-inbound
   retry authority without relaxing group routes.
4. Run scoped and reverse-dependent verification, required audits, commit,
   direct push to `main` as explicitly requested, and a single exact-head rollout
   with direct/group probes.

## State

In progress.

Status: active
Updated: 2026-07-13
