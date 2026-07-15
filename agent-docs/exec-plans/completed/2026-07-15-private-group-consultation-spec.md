# Private-to-group Murph consultation spec

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Specify a simple capability that lets a member's private Murph ask one of
  their joined group Murphs a bounded question, receive the answer privately,
  and combine it with private context without copying group state into the
  personal vault.

## Success criteria

- The consultation schema and model path never require, choose, or submit a
  membership id, group runtime id, chat id, mailbox id, or return route.
- A natural group reference resolves only within the callback-authenticated
  member's current memberships. One match proceeds; genuine ambiguity asks the
  member to choose using safe labels.
- Consultation uses a stateless request/result exchange over existing mailbox
  owners, rather than a synchronous cross-runtime mount, coordination table, or
  new group-context projection.
- The request mailbox item's existing global id binds an accepted private input
  to its first resolved group before retry, without another operation record.
- The group turn uses an isolated thread and an OS-confined, read-only group-data
  view with no model-visible runtime secrets. The model cannot persist group
  state or perform side effects; only ordinary system-mailbox progress is
  checkpointed.
- Membership is rechecked before accepting the request and before delivering
  the result. Leaving the group prevents later delivery.
- The product spec defines user-visible behavior, authority, privacy,
  reliability, limits, failure semantics, rollout, and direct proof.

## Scope

- In scope: proposed product and architecture contract, automatic membership
  resolution, asynchronous request/result flow, privacy boundaries, lifecycle,
  verification requirements, and durable-doc indexing.
- Out of scope: runtime implementation, actual schema or event-contract edits,
  synchronous cross-container RPC, general agent messaging, group-context
  projections, and UI implementation.

## Constraints

- Keep `HostedGroupMember` as the sole membership authority.
- Treat model-authored group names and questions as requests, never authority.
- Reuse existing encrypted mailbox dedupe, expiry, runtime signal, private
  return-route, retention, and usage owners.
- Keep private context in the private runtime unless the member explicitly asks
  to share a specific fact with the group.
- Preserve unrelated working-tree changes.

## Tasks

1. Trace the current membership, group-runtime, mailbox, and notification
   boundaries relevant to a consultation request and result.
2. Define deterministic automatic group resolution and ambiguity behavior.
3. Write and index the proposed product/architecture spec.
4. Run docs readback, drift, diff, privacy, and final-review checks.
5. Close the plan with a scoped commit.

## Verification

- Read back every touched Markdown file.
- Run `pnpm docs:drift` and `git diff --check`.
- Inspect the final diff for direct personal identifiers and unrelated changes.
Completed: 2026-07-15
