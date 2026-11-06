# Give Web delivery evidence one owner

Status: active
Created: 2026-11-06
Updated: 2026-11-06

## Goal

- One Linq inbound gets at most one answer: an ambiguous instant first reply can no longer become a runtime fallback, and a rejected retry can no longer erase earlier ambiguity.
- The delivery store owns the first-turn state table and the signup-suppression projection; Telegram secondary replies get the same durable dispatch fence as access notices.
- The always-false activation helper is gone.

## Success criteria

- Real-Postgres proof for overlapping reclaim and abandonment, first-dispatch rejection fallback, accepted or lost response followed by a retry rejection, same-millisecond attempts, legacy sealed skipped rows, and exact positive reconciliation.
- Real-Postgres proof that a Telegram secondary reply is one effect across duplicate updates, lost responses and overlap, with 429 and permanent rejection still recoverable.
- Existing concurrent last-live signup failure proof passes with the maintenance moved into the delivery owner.
- Live stage projection never builds `activating`; historical `activating` readers stay.

## Scope

- In scope: `linq-delivery-store.ts`, `linq-instant-first-turn.ts`, the Linq webhook planner's abandonment, `telegram-access-notice.ts`, `visible-secondary-webhooks.ts`, signup-suppression callers in transport, receipts and privacy deletion, and the activation helper.
- Out of scope: runtime first-send publication (held owner decision), Linq chat mutex changes, consent-withdrawal behaviour, and any schema change.

## Constraints

- Technical constraints: no migration. The version is the existing `attemptedAt` column; the certificate is a fixed `failureCode`.
- Product/process constraints: the exact-claim guard, untouched-reservation abandonment, certified rejection and all readers ship as one Web rollout. No bulk clearing of existing rows.

## Risks and mitigations

1. Risk: the conservative reader deploys before its certified-rejection writer and holds legitimate first rejections.
   Mitigation: one rollout, drain old send handlers, keep them together on rollback.
2. Risk: a chat-wide hold on a row nothing can resolve would lose later inbound messages, because the chat checks run before mailbox append.
   Mitigation: legacy held rows stop only their exact input; chat-level checks keep their current meaning.

## Tasks

1. Disposition function and exact-claim guard in the delivery owner.
2. Untouched-reservation abandonment and atomic certified rejection; delete the free-standing clear and skip-then-reread.
3. Move signup-suppression maintenance into the delivery owner.
4. Durable Telegram secondary replies with incoming-target authority.
5. Delete the activation helper and its plumbing.

## Decisions

- Held legacy rows (skipped with payload, uncertified failed without payload) defer their exact input and never resume. Nothing can establish that no ordinary answer intervened.
- Chat-level checks do not include held rows. See risk 2.

## Verification

- Commands to run: focused Vitest files, opt-in Postgres proofs against an isolated `murph_test_*` database, `pnpm --dir apps/web typecheck:prepared`.
- Expected outcomes: all pass; proofs fail on the base for B1, N5 and B4.

## Implementation evidence

- Base proofs reproduced B1 (losing abandonment resolved), N5 (resumed rejection
  returned fallback), and B4 (duplicate Telegram update sent twice): exit 1.
- First-turn owner now uses the exact attemptedAt version, atomic first-dispatch
  rejection and conservative disposition table. Activation producer removed;
  historical activating readers remain.
- First-turn and terminal-retry PostgreSQL proofs: 110 passed, exit 0.
- Focused first-turn, planner and delivery-store unit proofs passed. Activation
  fixtures and runtime egress coverage passed in the focused six-file run
  (313 tests, exit 0).
- The single end-of-task typecheck exited 2 on five fixture typing errors.
  Those fixtures were corrected and focused tests passed; typecheck was not
  repeated under the task's one-run limit.
- The plan remains active. No push, CI or remote review is part of this local task.

- Signup suppression now commits within the delivery owner. Transport retains
  its existing fallback and sent conditions; receipts return only contact-card
  context. Privacy deletion calls the extracted batched projection maintenance
  immediately after deleting delivery rows. Reminder allowance is unchanged.
- Both signup templates construct IDs through the same signup effect builder;
  acceptance can therefore derive member/day from the ID, including no-op replay.
- Focused signup, transport, planner, privacy and outreach units: 656 passed.
- New signup owner PostgreSQL cases and unchanged concurrent last-live proof:
  5 passed. The unrelated 20,000-row index fixture was excluded by name.
- The raw privacy unit command initially lacked the generated changelog module;
  the existing `pnpm --dir apps/web changelog:generate` completed with exit 0.
- Telegram secondary replies now use a durable incoming-event/target claim
  without member lookup. Focused Telegram units: 115 passed; PostgreSQL: 7 passed.
- Complexity passes for all 14 changed source files. The planner reuses its
  existing model-admission predicate instead of repeating the condition.
