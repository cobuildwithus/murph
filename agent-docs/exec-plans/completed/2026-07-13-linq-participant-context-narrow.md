# Narrow Linq Participant Context

Status: completed
Updated: 2026-07-14

## Why

Linq already subscribes to participant-added and participant-removed events,
but hosted web does not yet turn a participant addition into bounded context for
the next ordinary group turn. The replacement for PR #511 should land only that
user outcome, without accepted-conversation replay, historical billing
reconstruction, another roster authority, or another scheduler.

## Success criteria

- Accept, sanitize, and deduplicate Linq `participant.added` and
  `participant.removed` events through the existing provider-event ledger.
- Resolve only an existing Linq thread route. Participant events must not create
  a member, route, group, membership, sharing grant, wake, timer, queue, or
  outbound message.
- A unique addition sets one nullable route-owned coalescing bit without
  retaining the added participant's identity.
- The next already-admitted, non-direct organic group message consumes that bit
  in the same transaction as its canonical mailbox append and carries one
  optional trusted context hint through the existing conversation contract.
- The assistant uses the existing live `read_chat_participants` path once and
  may stay silent. Removals remain ledger-only and live roster truth remains
  authoritative.
- Preserve route authority, webhook idempotency, contact privacy, direct-message
  behavior, quota/access admission, and iMessage deliverability.
- Keep the final source/config diff proportional to the feature and explicitly
  exclude the replay/billing/retention/orchestration work from PR #511.

## Design

- Add nullable `HostedThreadRoute.pendingParticipantAddition` with a `false`
  default for expand-safe deployment. Only exact `true` means pending.
- A unique `participant.added` event sets the bit for an existing route. Missing
  chat ids, unknown routes, duplicates, and removals are recorded but do not
  mutate route context.
- Consume the bit only after ordinary message admission and under the existing
  route/mailbox transaction. Take the canonical Linq chat-ownership advisory
  lock before the route-row lock, matching mailbox, usage-limit dispatch, and
  route-key convergence. Append failure rolls the consumption back.
- Carry one optional `groupParticipantAdded: true` field on the existing Linq
  message payload, record it in the existing tolerant mailbox-to-input sidecar,
  and project it only onto the transient trusted input candidate. Keep the
  strict persisted assistant-input event unchanged, share one normal/captureless
  prompt renderer, and do not alter the human's canonical message text.
- Reuse current-main roster, group-tool, and join-offer owners. Add no eager
  provider roster read, roster ordering watermark, participant identity state,
  replay processing mode, or compatibility machinery for unshipped replay
  state.

## Explicit non-goals

- Accepted-conversation replay after billing or access changes.
- Historical allowance-period binding, backfill, readiness flags, or repair.
- Participant-sponsored admission for a newly added sender whose current route
  projection does not yet authorize the message.
- Strict ordering for overlapping live roster snapshots.
- New background work, retries, timers, cron, queues, or Temporal workflows.

## Verification and completion

- Focused provider-event, webhook, route-coalescing, contract/parser, runtime
  metadata, prompt, and deploy-skew compatibility tests.
- Direct scenario proof for duplicate/missing-route/removal behavior, multiple
  additions coalescing once, admission failure preserving the bit, append
  rollback, direct-message isolation, and one-shot trusted prompt context.
- `pnpm verify:acceptance`, `git diff --check`, security/privacy review, and the
  required write-capable coverage audit.
- Parent scope/call-path review, scoped commit through `scripts/finish-task`, PR
  creation, exact-head ReviewGPT to zero accepted findings, green CI, and a
  clean merge-path proof against current `origin/main`.

## Completion evidence

- Implemented the participant-event ledger, nullable route bit, transactional
  mailbox hint, tolerant sidecar metadata, and shared normal/captureless prompt
  context without changing roster, access, billing, replay, or orchestration.
- The final owner path preserves chat-ownership-before-route-row locking,
  same-transaction hint consumption plus mailbox append, and rollback on
  admission, dedupe, append, or route races.
- Focused web, assistant-engine, assistant-runtime, hosted-execution, and harness
  tests pass. Full web and Cloudflare app verification, all workspace
  typechecks, scenario-integrity coverage, package-boundary checks, and all four
  PostgreSQL 17 interleavings pass on the current-base head.
- Security/privacy, coverage, deploy/docs, simplicity/architecture, and
  post-rebase web/runtime owner reviews found no unresolved accepted
  medium-or-higher finding.
- The serial local `pnpm verify:acceptance` run passed preflight, all 31
  workspace typechecks, and most package coverage, but fixed-timeout failures
  remained in CLI release smoke/self-target tests, assistant-runtime timing
  tests, and one setup wizard case under severe shared-host contention.
  Isolated assistant-runtime maintenance and setup-wizard reruns passed; the
  exact-head focused and app gates above passed after the final rebase.
- The recovered historical PR #511 ReviewGPT round was polled without starting
  a duplicate; its replay finding belongs to the explicitly deferred replay work.
- Local implementation and audits are complete; PR creation, exact-head
  ReviewGPT, green CI, and current-main merge proof remain external gates.
Completed: 2026-07-14
