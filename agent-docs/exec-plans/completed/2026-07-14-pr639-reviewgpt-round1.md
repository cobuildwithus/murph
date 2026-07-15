# PR 639 ReviewGPT Round 1 Remediation

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

Remove hosted exact-id live admission so each mailbox input starts under its
own durable provider-turn and effect identity, while retaining the small pure
route/account/actor selector used by ordinary local source scans.

## Accepted finding

ReviewGPT found that input B could enter input A's active provider turn before
B owned a durable effect identity. A crash after an irreversible B-side effect
could then replay B under a second identity, and A-B-A notification ordering
could skip around B. The failing hosted Linq E2E also observed B's reply before
A's reply.

## Success criteria

- Exact staged ids may locate the active conversation owner but never enter
  source admission or provider input.
- A late input remains pending and becomes the causal anchor of the next
  provider turn.
- The pure route/account/actor selector remains for local ordered scans.
- Delete `availableInputIds`, hosted exact-id lookup, and cursor-bypass
  plumbing; add no queue, index, manager, compatibility layer, or new state.
- Preserve current-main group-reaction context behavior.
- Focused tests prove generic wake coalescing, A-B-A ordering, and separate
  replies in causal order.

## Tasks

1. Delete exact-id admission across the active controller and hosted source.
2. Retain and narrow the local ordered selector.
3. Update focused unit and hosted Linq E2E regressions.
4. Run coverage-bearing scoped verification and required completion audits.
5. Finish the scoped commit, push, and run ReviewGPT Round 2 with CI.

## Completion

- Branch rebased onto `main` after PR #641; the overlapping hosted-runtime
  coordination rewrite is now entirely owned by `main` and absent from this
  patch.
- Exact ids locate and coalesce the active conversation wake but no longer
  enter admission or provider input.
- Late input stays in the existing mailbox and becomes the next ordinary
  causal turn; no replacement state or recovery path was added.
- ReviewGPT Round 1 High is accepted and covered by separate-turn unit and
  hosted Linq E2E regressions.
- Focused assistant-engine tests passed 166/166, assistant-runtime tests passed
  11/11, and the hosted Linq ordering E2E passed 1/1.
- Coverage review found no remaining proof gap. The full diff lane passed the
  affected typechecks and guards before reaching an unrelated current-`main`
  prompt-size failure (`61,018 > 61,000`); this patch changes no prompt surface.
Completed: 2026-07-14
