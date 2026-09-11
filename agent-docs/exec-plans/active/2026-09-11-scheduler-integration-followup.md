# Align scheduler integration proof with current runtime ownership

Status: active
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- Align public full-stack scheduler proofs with the merged runtime's foreground admission and bounded background retries so private scheduler integration can be evaluated accurately.

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
2. Accepting an existing system owner could weaken foreground proof.
   Mitigation: retain active-fence identity checks, checkpoint ordering, response latency, and system progress measured after provider start.

## Tasks

1. Confirm Linux integration failures against the unchanged private candidate. Done: twelve scenario lanes passed; foreground ownership and terminal drain expectations failed.
2. Correct the terminal drain allowance and enclosing test budget.
3. Update foreground proof to cover admission by the current fenced owner and replacement admission.
4. Run focused E2Es and typecheck; review the full candidate and privacy.
5. Complete the public PR and rerun private full integration against merged public main.

## Decisions

- The merged runtime explicitly supports admitting foreground work through the existing system invocation after acknowledgment; replacement is not mandatory.
- Successful processing can append follow-up wakes. The recovery proof requires both imported frontiers to cover the seeded sequence and subsequent successful processing, rather than requiring the entire evolving mailbox to be empty.
- The terminal drain may span 30-second, two-minute, and ten-minute no-progress retries plus a bounded device pass. Allow fifteen minutes for that stage in addition to the existing setup/intermediate budget.
- Public changes are test-only; no member-visible changelog entry or new runtime review is needed.

## Verification

- `pnpm hosted-local e2e foreground-reply-priority --process-shard 1/2`: checkpoint ordering, prompt reply, one send, and later system progress pass.
- `pnpm hosted-local e2e linq-reminder-device-sync-non-starvation`: one due reminder runs during a receipt-bounded pass and the backlog drains.
- Run both with the private worker package and UTC local PostgreSQL sessions.
- Cloudflare typecheck and `pnpm complexity:diff` pass; exact-head CI remains required.
- Initial unmodified local fairness run passed. A subsequent run hit the original enclosing fifteen-minute test timeout; the enclosing budget must include the terminal allowance before repeating proof.
- Initial updated foreground run: six cases passed; the changed case passed reply and acknowledgment assertions, then failed recovery's exact lane snapshot because a follow-up wake was appended. Corrected that proved test assumption and retained actual post-provider processing evidence.
