# Consented group-to-member disclosure

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Let an authenticated hosted group ask a current member's personal read-only
  assistant for information covered by an explicit, immutable user grant.
- Return information only after a fresh-context outgoing reviewer verifies the
  proposed disclosure against the exact grant text.

## Success criteria

- Group membership and an active disclosure grant are both required; neither is
  inferred from the other.
- The server binds every request to the exact current group, membership, member,
  personal runtime, and immutable grant before mailbox delivery.
- The personal answer pass has read-only vault access and the outgoing reviewer
  sees only the question, exact grant text, and proposed disclosure.
- There is no incoming scope-review model. Requests outside the grant either
  produce no proposed disclosure or are rejected by the outgoing reviewer.
- Revocation or group departure invalidates queued and replayed requests.
- Existing private-to-group Assistant Ask behavior remains unchanged.
- Focused regressions, truthful owner verification, required audits, PR CI, and
  exact-head ReviewGPT all pass.

## Scope

- In scope: persisted disclosure grants, exact group-message reaction consent,
  private list/revoke controls, group tool and hosted-mailbox request plumbing,
  personal read-only answer execution, one independent outgoing disclosure
  review, tests, and durable protocol/product/security documentation.
- Out of scope: Call Circle orchestration, fan-out scheduling, incoming request
  review, generalized policy engines, arbitrary container-to-container access,
  background retries beyond the existing Assistant Ask mailbox lifecycle, and
  changes to fixed-schema vault projections.

## Constraints

- Store user-facing/queryable grants in the web control plane, never assistant
  runtime state.
- Treat exact grant text as immutable policy data, not executable prompt
  instructions, with bounded count and length.
- Fail closed on ambiguous member/grant selectors, stale membership, revocation,
  inactive runtimes, malformed output, reviewer denial, or reviewer failure.
- Reuse the existing paired Assistant Ask mailbox transport and detached one-shot
  runtime instead of adding a service, queue, or state machine.
- Preserve all unrelated worktree and coordination-ledger changes.

## Tasks

1. Define the minimal persisted grant and wire-contract extensions.
2. Add exact current-member Like consent and private revocation handling.
3. Add authenticated group-to-member admission and paired mailbox routing.
4. Add the read-only personal answer pass and fresh outgoing reviewer.
5. Add focused authority, replay, prompt-boundary, reviewer, and UX regressions.
6. Update durable docs, verify, audit, commit, push, and complete PR gates.

## Verification

- Focused package and web tests for contracts, grant lifecycle, admission,
  mailbox completion, read-only execution, outgoing review, and reaction consent.
- `pnpm test:diff` over the exact touched paths when its selected owner/reverse-
  dependent coverage remains truthful; otherwise `pnpm verify:acceptance`.
- Required coverage-write audit, parent final review, PR CI, and ReviewGPT on the
  exact pushed head.
Completed: 2026-07-16
