# PR 508 steered voice-media fallback

## Goal

Triage and, if reproduced, fix the Mountain ReviewGPT finding that a
voice-only continuation after a live steer can return the previous text segment
and discard the current voice memo.

Success criteria:

- Reproduce or reject the reported state transition through the Codex
  app-server runtime boundary.
- Keep fallback text and response media scoped to the same delivery-context
  segment.
- Preserve trailing-steer behavior when no newer response segment exists.
- Push the verified fix and rerun the Mountain PR ReviewGPT loop to zero
  accepted findings on the final head.

## Constraints

- Keep the correction at the existing response-segmentation owner; do not add
  provider-specific deduplication or persisted state.
- Preserve explicit final text, media-only replies, no-reply selection, and
  prior-segment ordering.
- Preserve unrelated work and keep private incident data out of fixtures,
  commits, logs, and review artifacts.

## Approach

1. Add a focused failing regression for prior final text, steer, commentary,
   generated voice memo, and an empty current final.
2. Scope fallback state at the steer boundary and select the newest response
   segment when it has text or media.
3. Run focused tests, owner coverage/typecheck, required completion audits, and
   final diff/privacy checks.
4. Commit, push, and rerun Mountain ReviewGPT plus PR CI.

## State

Mountain round 2 returned one High finding. A focused runtime test reproduced
the stale-text/media-loss path, and the narrow response-segment ownership fix
is implemented and locally verified. Required coverage-write and
security/privacy audits found no missing proof or medium-or-higher finding. The
change is ready for its scoped commit, latest-main rebase, and final Mountain
round.

## Notes

- The first Mountain attempt used a stale local ReviewGPT binary and returned
  an invalid model-confirmation response. Dependency sync installed the
  lockfile-selected release, and the corrected round completed normally.
- The rebased PR head had fully green CI before this finding was triaged.
- The fix clears fallback text state when a steer closes a response segment,
  promotes that segment when the current segment has text or media, and keeps
  the closed segment final when no newer response exists.
- Focused tests (3/3), the full Codex runtime file (154/154), package typecheck,
  workspace typecheck, and the isolated broad-suite timeout targets pass.
- Full coverage passed 2007 tests and reported coverage, but one unrelated
  outbox retention test exceeded its 60-second suite timeout; it passed alone.
  Diff-aware verification likewise reached affected-package tests, where one
  unrelated assistant CLI import test exceeded its parallel 30-second timeout;
  that file passed alone (3/3).
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
