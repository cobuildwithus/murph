# Hosted Ask round-seven remediation

## Outcome

Resolve ReviewGPT round seven without restoring the deleted Ask coordinator:
prioritize only completions that actually predate pending personal input, keep
cross-turn carrier retries from freezing the conversation, and limit dirty-window
early admission to joined-group Ask requests.

## Decisions

- Automatic wake and natural private-Murph composition remain the user-visible
  contract; the raw group answer is never sent directly.
- Ordering is owned at assistant-turn admission: an older completion is processed
  and durably queued before later personal input. External carrier delivery across
  separate turns is not globally serialized, so a retrying send cannot block the
  personal conversation indefinitely.
- The ordinary outbox keeps its current same-turn ordering contract. Add no new
  persisted predecessor, coordinator, queue, scheduler, or reconciliation pass.
- Only `joined_group` requests may use pre-checkpoint admission. The distinct
  `consented_member` flow retains its ordinary checkpoint timing and reviewed-exact
  delivery behavior.

## Plan

1. Record the round-seven requirement-level retrospective in the PR.
2. Restore the smallest timestamp comparison at the existing mailbox selection
   boundary and narrow pre-checkpoint request admission to joined groups.
3. Add focused reverse-order and target-kind regressions.
4. Run required verification, close the plan, commit, push, and report the exact
   review/CI state without starting another substantive round implicitly.

## Verification

- ReviewGPT round seven completed with a requirement-level retrospective.
- Assistant Runtime owner suite: 76 files passed; 1,792 tests passed and 2
  skipped.
- Assistant Runtime typecheck: passed.
- Focused dirty-window proof still records zero early checkpoint requests and
  only the existing `idle_shutdown` snapshot reason.
- Documentation drift and diff checks: passed.
- Canonical changed-file verification: passed. Assistant Runtime ran 76 files
  with 1,792 passing tests and 2 skipped; Cloudflare Node ran 106 files with
  1,856 passing tests; Cloudflare Workers ran 1 passing test.
- Repo acceptance verification: passed after refreshing the worktree's stale
  installed ReviewGPT package from the unchanged frozen lockfile. The isolated
  CLI release-audit rerun passed 39 tests with 1 skipped before the full gate
  passed.

## Result

The existing automatic wake now admits only causally older joined-group
completions ahead of pending personal input, and only joined-group requests use
the dirty-window pre-checkpoint fast path. The natural private continuation,
stable outbox key, detached read, and routine idle-checkpoint floor remain
unchanged. No new persistent state or Ask-specific lifecycle owner was added.

Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
