# SEV-0 hosted reply liveness recovery

## Goal

Restore hosted direct-message replies without preserving restart-sensitive route
authority in the assistant input path.

Success criteria:

- Assistant inputs are no longer rejected before model execution by transient
  runtime route state.
- The delivery boundary authorizes a direct reply only from an exact persisted
  inbound, while group routes remain strict.
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
  receipt all succeeded for affected direct messages.
- Persisted prepared direct replies retain their answered mailbox item IDs, but
  retry-time route authorization currently sees only transient live wake context.
  A restart can therefore discard the exact direct-inbound proof and reject the
  later delivery with a route-authority 403.
- Production also shows a separate five-second runtime-wake timeout against an
  already-active long-running invocation. It remains under investigation and is
  intentionally outside this patch until its lifecycle owner is proven.
- Recovered pending inputs can outlive the runtime-only mailbox-item sidecar.
  Reconstructing authority from the blinded input reference cannot identify the
  canonical mailbox row, so the pre-model authority check repeatedly returns
  `HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH` even though the retained direct
  inbound is still present server-side.

## Approach

1. Delete the redundant pre-model route-authority filter and its tests so input
   acceptance no longer depends on a restart-sensitive runtime sidecar.
2. Keep the existing strict delivery-boundary authority check as the single
   owner of reply authorization.
3. Revalidate persisted answered mailbox IDs server-side for exact direct-inbound
   retry authority without relaxing group routes.
4. When a prepared delivery lacks that runtime sidecar, scan a bounded set of the
   member's retained canonical conversation rows and require an exact member,
   thread, provider-message, inbound, and directness match.
5. Run scoped and reverse-dependent verification, required audits, commit,
   direct push to `main` as explicitly requested, and a single exact-head rollout
   with direct/group probes.

## State

Implementation and focused verification complete; production rollout pending.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
