# Align scheduler integration proof with bounded progress

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- Align public full-stack scheduler proofs with bounded background retries and seeded progress despite subsequently appended work, so private scheduler integration can be evaluated accurately.

## Success criteria

- Focused foreground and reminder/device-sync E2Es pass with the private scheduler candidate.
- Cloudflare typecheck, candidate review, and required public PR checks pass.
- Commit and merge the scoped public proof correction; then resume private scheduler integration in the original completion session.

## Scope

- In scope: two stale E2E expectations and their existing friction records.
- Out of scope: runtime behavior, scheduler policy, production deployment, and unrelated verification audit findings.

## Constraints

- Preserve canonical acknowledgment before provider start, prompt reply, exactly-once delivery, single initial admission, and eventual backlog drain.
- Use isolated synthetic local services; preserve the private candidate and unrelated worktrees.

## Risks and mitigations

1. Longer waiting could conceal a stalled queue.
   Mitigation: retain the zero-backlog and multiple-positive-pass assertions; bound the terminal wait by the actual retry schedule and retain shorter intermediate deadlines.
2. Ignoring total lane lag could conceal missing seeded work.
   Mitigation: retain both seeded import frontiers, no retryable blocks, attributed successful post-provider processing, exact provider-start fence, and checkpoint/reply checks.

## Tasks

1. Confirm Linux integration failures against the unchanged private candidate. Done: twelve scenario lanes passed; foreground ownership and terminal drain expectations failed.
2. Correct the terminal drain allowance and enclosing test budget.
3. Preserve the merged foreground ownership proof and remove only the recovery requirement that subsequently generated work has already drained.
4. Run focused E2Es and typecheck; review the full candidate and privacy.
5. Complete the public PR and rerun private full integration against merged public main.

## Decisions

- PRs #3300 and #3305 merged ownership and monotonic-frontier corrections during verification. Reuse those changes and preserve their exact foreground fence assertion.
- Successful processing can append follow-up wakes. The remaining correction removes total lane lag as a prerequisite for observing imported seeded work and subsequent successful processing.
- The terminal drain may span 30-second, two-minute, and ten-minute no-progress retries plus a bounded device pass. Allow fifteen minutes for that stage in addition to the existing setup/intermediate budget.
- Public changes are test-only; no member-visible changelog entry or new runtime review is needed.

## Verification

- `pnpm hosted-local e2e foreground-reply-priority --process-shard 1/2`: checkpoint ordering, prompt reply, one send, and later system progress pass.
- `pnpm hosted-local e2e linq-reminder-device-sync-non-starvation`: one due reminder runs during a receipt-bounded pass and the backlog drains.
- Run both with the private worker package and UTC local PostgreSQL sessions.
- Cloudflare typecheck and `pnpm complexity:diff` pass; exact-head CI remains required.
- Initial unmodified local fairness run passed. A subsequent run hit the original enclosing fifteen-minute test timeout; the enclosing budget must include the terminal allowance before repeating proof.
- Initial updated foreground run: six cases passed; the changed case passed reply and acknowledgment assertions, then failed recovery's exact lane snapshot because a follow-up wake was appended. Corrected that proved test assumption and retained actual post-provider processing evidence.
- Reminder/device-sync E2E passed with the private scheduler candidate and corrected enclosing budget: one test, 704.63 seconds, one reminder during positive receipt-bounded progress followed by full drain.
- Nine actual-observer probes reproduced the baseline follow-up-lag failure, accepted proved seeded progress, and rejected seven invalid recovery states.
- Final foreground process 1/2 passed all seven selected tests in 505.21 seconds. The corrected system-mailbox case retained its exact fence and completed the reply in 7.323 seconds against the thirty-second limit. The four checkpoint-ordering cases belong to process 2/2 and were not selected; the earlier private full integration passed that unchanged lane.
- Cloudflare typecheck, complexity guard, privacy scan, whitespace check, and parent candidate review passed after reconciling the base. Final diff changes no production source or configuration.

## Completion handoff

The implementation and focused proof are complete. PR #3303 still requires exact-head CI and merge. The original session retains completion ownership and will then rerun private PR #132 full integration against public main before merging the unchanged private candidate. No production deployment is included in this plan.
Completed: 2026-09-11
