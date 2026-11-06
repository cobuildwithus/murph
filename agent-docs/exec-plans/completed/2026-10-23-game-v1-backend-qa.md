# Game negotiation recovery and dev ticket clock

Status: completed
Created: 2026-10-23
Updated: 2026-10-23

## Outcome and invariants

Restore acceptance of unchanged terms after a negotiation proposal is removed.
Only the claimed invitee may accept; pending proposals, expiry, exact terms,
pair uniqueness, and exactly-once kickoff remain enforced. Dev tickets receive
14 days on the same game clock that judges expiry; production timestamps retain
their existing database default.

## Ownership and evidence

The locked game service owns acceptance and ticket issuance. Cancellation clears
pendingChange while retaining negotiating status and both seats; decideJoin
previously rejected that state. Ticket issuance used real database time while
views and redemption use gameNow. Reuse those owners without new state or APIs.

## Product UX

Outcome: restore acceptance and preserve both players' negotiation choices.
Reaches: claimed invitee after cancel/decline, challenger proposing or waiting,
outsider, pending proposal, expired invite, and dev ticket holder/debtor.
Proof: real PostgreSQL command/readback suites, repeated acceptance, deadline
checks, and dev settlement/wallet/redemption checks. iOS can derive acceptance
from existing status, pendingChange, players.isMe/seat, and inviteToken fields.

## Tasks and completion gates

1. Add focused PostgreSQL regressions and the smallest owner corrections.
2. Update durable contract and member changelog; run game suites, Web typecheck,
   complexity, log guard, and docs drift. Review the full diff and UX evidence.
3. Run the explicitly requested read-only Codex deep review; commit via wrappers.
4. Push a draft PR, mark ready, and launch eragon ReviewGPT concurrently with CI.
5. Merge after exact-head gates, verify production SHA admission/deploy/health,
   update the external task status, and retire the clean worktree.

## Deployment and failure

Web-only change with existing record and wire shapes. No migrations, runtime
reader changes, or backfills. Old Web may still refuse recovered acceptance
until convergence. No new queries, crypto, provider calls, or transactions.
Fix forward only; no rollback is authorized.

## Verification

- Game PostgreSQL suites: 78 cases across 10 files passed, composing the
  77 passing cases in the full run with the corrected 16-case change suite rerun.
  The initial start-now fixture failure was time-dependent, pre-existing, and
  fixed by selecting an explicit future start date; the Frog entry is committed.
- Focused rules, changes, views, command, time, and changelog rendering: 109 passed.
- Web typecheck, complexity diff (maximum 19, zero hotspots), logs guard,
  docs drift, and diff whitespace checks passed.
- Requested independent gpt-6-astra Codex read-only deep review: no findings.
- Parent review and backend Product UX walkthrough: Ready. Existing fields
  expose the seat-1 acceptance condition; the iOS consumer must use it. No
  whole-invite cancellation endpoint exists in the shipped contract.
- PR review, exact-head CI, merge, and deployment evidence remain with the
  completion owner in the external backend-fix status document. This plan
  closes implementation; it does not claim those later gates passed.
Completed: 2026-10-23
