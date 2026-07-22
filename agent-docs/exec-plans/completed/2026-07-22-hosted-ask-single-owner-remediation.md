# Hosted Ask single-owner remediation

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

Complete the PR #840 round-four requirement-level retrospective, then replace
the split generic/pre-input/no-input Ask selection paths with the smallest
single-owner design that preserves every completed Ask occurrence until its
outbox-owned delivery state is terminal or safely parked.

## Trigger

ReviewGPT substantive round four returned `RETROSPECTIVE_REQUIRED`. It verified
the round-four no-input correction and the unchanged idle snapshot boundary,
but proved that deferred maintenance with an already-pending personal input can
still route a newer Ask completion through the generic consumer and remove its
ordering anchor. It also identified cross-route head-of-line and dynamic
fresh-input preemption surfaces that the current split ownership does not define
or prove.

## Retrospective decision

The immutable first-reviewed head changed 146 authored production-source lines
(117 added, 29 deleted) across two files. The current head changes 597 (587
added, 10 deleted) across ten production files. Review remediation accounts for
536 additions and 47 deletions. Tests grew from 346 additions and 10 deletions
across three files to 1,786 additions and 28 deletions across eight files.

The repeated failure mechanism is split selection ownership. A retained mailbox
row is the occurrence/order fact and the outbox intent is the delivery fact, but
generic maintenance, the pre-input Ask barrier, and the added no-input Ask path
could each select the same completion under different rules. Successive fixes
closed one bypass while leaving another.

The alternatives were evaluated as follows:

- Delete the feature: rejected because accepted Ask work must reach a terminal
  user-visible outcome.
- Revert to the first-reviewed head: rejected because it restores already
  reproduced ordering, exact-selection, and fast-start defects.
- Merely shrink helpers or split them into another module: rejected because it
  leaves multiple consumers and moves rather than removes the invariant.
- Transfer ordering entirely into outbox intents: rejected for this PR because
  it requires persisted causal metadata plus an outbox-wide Ask selector, both
  broader than the existing mailbox occurrence primitive.
- Continue the current split shape: rejected because deferred maintenance still
  bypasses retention and a future no-input Ask can block unrelated routes.
- Redesign around one existing consumer: selected.

The selected design makes the Ask-completion coordinator the exclusive consumer
of `continue-assistant-ask` rows. Default generic preparation excludes those
rows, while explicit Ask preparation always retains them. One coordinator runs
at one top-level phase boundary:

- with pending personal input, it selects only the oldest Ask strictly older
  than that input and treats a future outbox-owned wake as its prerequisite;
- without pending personal input, it follows the ordinary globally-next due
  system-mailbox selection, so a future Ask blocks only its own route and never
  unrelated due work;
- if fresh input appears after the no-input sample, it preempts and retains the
  Ask, then re-evaluates occurrence order on the next phase;
- invalid, terminal, missing, expired, or safely parked work is discharged and
  the next eligible Ask is reconsidered;
- retry, confirmation grace, stale reconciliation, ambiguity, and delivery
  terminality stay solely in the existing outbox owner.

This direction deletes the second in-maintenance no-input lane, closes the
generic deferred-maintenance bypass at the owner boundary, adds no queue,
scheduler, state owner, outbox compatibility scan, or private wake rule, and
does not touch the idle/shutdown workspace snapshot schedule.

## Retrospective requirements

- Restate the original user-visible requirement and compare the immutable first
  reviewed shape with the current shape.
- Attribute review-driven growth and the repeated occurrence-anchor failure
  mechanism.
- Compare deletion, reversion, shrinking, splitting, redesign around one
  existing owner, and explicitly justified continuation.
- Choose and record one direction before tactical code changes.
- Define complete ordering for older and newer Ask completions, deferred
  personal input, unrelated due system work, future delivery wakes, and fresh
  input arriving after an initial no-input sample.
- Disclose and prove generic mailbox route ordering, deferred-input
  maintenance, dynamic foreground preemption, and the unchanged idle/shutdown
  workspace snapshot boundary.

## Constraints

- Mailbox occurrence/order ownership and outbox delivery/retry/ambiguity
  ownership remain explicit and non-overlapping.
- Prefer deletion and one existing owner. Do not add a queue, scheduler, state
  machine, compatibility scan, private wake calculation, or persisted owner.
- Only an Ask completion proven older than accepted personal input may block
  that input as a prerequisite.
- Unrelated due system routes must not be stranded behind a future Ask delivery
  wake unless the recorded product ordering policy explicitly requires it.
- The expensive workspace snapshot stays on the existing idle/shutdown
  schedule; Ask handling must not publish, advance, or shorten it.
- Durable artifacts remain free of private conversation, health, member, and
  local-machine identifiers.

## Approach

1. Record the requirement-level retrospective and architecture decision.
2. Reproduce the deferred-input anchor-loss path and dynamic fresh-input race.
3. Implement the smallest single-owner correction, deleting obsolete lanes and
   review machinery where possible.
4. Add production-shaped ordering/preemption and unrelated-route regressions.
5. Run coverage-write, scoped verification, canonical diff-aware and acceptance
   verification, then push the exact head.
6. Run ReviewGPT round five concurrently with exact-head CI and resolve any
   accepted finding without starting a sixth substantive round automatically.

## Verification

- Coverage-write audit: passed with no unresolved gaps. Added production-shaped
  proof for future Ask wakes beside unrelated generic work and for pending
  personal input preceding a newer Ask.
- Focused Assistant Runtime suite: 291 tests passed.
- Dirty-window entrypoint regression: passed; zero early snapshot requests and
  the sole later snapshot reason remains `idle_shutdown`.
- Assistant Runtime typecheck: passed.
- `pnpm docs:drift`: passed.
- `pnpm test:diff packages/assistant-runtime`: passed, including 1,808 Assistant
  Runtime tests and 1,852 affected Cloudflare tests.
- `pnpm verify:acceptance`: passed, including repository-wide typechecks,
  coverage, app verification, web production build, and architecture/privacy
  guards.
- `git diff --check` and added-line privacy scan: passed.
- Exact-head CI and ReviewGPT round five run after the scoped commit is pushed.
Completed: 2026-07-22
