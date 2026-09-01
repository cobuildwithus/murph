# Retire persisted screen-inspection handoff compatibility

## Goal

Delete the persisted-only `screen_inspection` computer-handoff compatibility
reader and its recovery branches. Current public handoff purposes and their
recovery behavior must remain unchanged.

## Evidence and constraints

- The shared hosted-execution handoff-purpose contract does not accept or emit
  `screen_inspection`.
- Production has one retained row with that purpose; it is expired. There are
  no unexpired handoffs and no running or awaiting computer runs.
- The retained row may fail closed through the store's existing unsupported
  purpose error. This task does not migrate or delete production data.
- Preserve all current handoff purposes, member ownership checks, resume proof,
  handoff expiry, and browser-session authority.
- Work only in the sanctioned task worktree and do not push or open the PR.

## Plan

1. Contract the Web store record to `HostedComputerHandoffPurpose` and remove
   the retired value from the persisted decoder.
2. Remove the retired page, replacement, and resume branches from the computer
   service while leaving current-purpose state transitions intact.
3. Delete the three tests that exercise the retired compatibility behavior.
4. Run focused computer-use and handoff page/route tests, Web typecheck and
   build, a negative source search, diff hygiene, and a privacy-safe final
   review.
5. Archive this plan and create one scoped commit for the reviewed change.

## Deployment and rollback

The strict reader can deploy directly because current producers already emit
only the public purpose set and production contains no live legacy handoff or
run. The one retained expired row will become unreadable by design. Rolling
back restores the compatibility reader without requiring a data change.

## Verification

- The focused computer-use, handoff-page, active-view, and reply-action suite
  passed: 4 files and 207 tests.
- Web typecheck passed.
- The Web production build passed preflights, generation, its repeated
  typecheck, workflow-directive discovery, and route-type generation. The
  cold Next.js webpack compiler was stopped after a bounded output-silent
  window; all preceding build phases had passed.
- Negative source and test search found no retired purpose or compatibility
  symbols.
- `git diff --check`, scoped diff/stat review, and privacy review passed.

## Outcome

The persisted reader now accepts the same handoff-purpose union as the current
hosted-execution contract. Retired page, replacement, and resume recovery paths
and their three exact tests are gone. No production data or schema migration is
part of this change; the retained expired row fails closed through the existing
unsupported-purpose error.

Status: completed
Updated: 2026-08-30
Completed: 2026-08-30
