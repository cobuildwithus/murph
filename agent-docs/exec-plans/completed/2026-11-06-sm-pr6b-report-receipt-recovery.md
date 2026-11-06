# Recover every game report from its receipt

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Goal

- A report the server accepted can always finish its alert retry, whatever
  happened to the reported source since.
- The same provider idempotency key always carries byte-identical payload.

## Success criteria

- Addressed invite plus block plus first alert failure completes on retry.
- Retries survive removed posts, deleted accounts, deleted games and cleared
  foreign keys, and send the first payload unchanged.
- Mismatched report-ID reuse is refused with no block and no email.
- A genuinely new report still needs a currently readable source.
- A receipt from before this change is never rebuilt under its old key.

## Scope

- In scope: `report`, `reportReply`, `block`, `canEnterGame`, the report alert
  and four additive `GameReport` columns.
- Out of scope: the Ops queue label, the recap half of the original PR 6, and
  the alert recipient configuration.

## Constraints

- Technical constraints: no new owner, outbox or table. Additive migration only.
  Member lock order and the session fence on block writes stay as they are.
- Product/process constraints: plain report behaviour stays as it is. The report
  remains in the Ops queue whatever happens to its email.

## Risks and mitigations

1. Risk: a receipt check refuses a legitimate identical retry.
   Mitigation: a cleared foreign key or an unresolvable token cannot contradict a
   receipt, and `reportedMemberId` is compared only for player reports, because
   post and terms reports ignore that field when created.
2. Risk: widening the HTTP door.
   Mitigation: same shape as the outgoing-block clause. Commands still check
   their own game, and a game with no listed member stays off.

## Tasks

1. Add the frozen columns and write them when a report is accepted.
2. Make every report kind read and validate its receipt first.
3. Build every alert only from the receipt.
4. Let the receipt authorize the block, and let its owner through the door.
5. Prove each at the real database boundary and update the owner docs.

## Decisions

- Game id is frozen as a fourth column. It is printed in the alert and
  `GameReport.gameId` is `SET NULL`, and account deletion removes a game nobody
  else is in, so three frozen fields would not keep the payload identical.
- A legacy receipt skips its email. Its first send may have reached the provider
  and nothing proves what it said. The retry still succeeds, its block still
  runs, and the report stays in the Ops queue. There is no server-side alert
  retry today, so this matches a member who gave up retrying.
- A retry may change the reason, note or block flag, because the report sheet
  stays open after a failure. The stored values win for the alert. A retry that
  asks to block still blocks the stored subject.

## Verification

- Commands to run: focused Vitest on real PostgreSQL for
  `game-report-block-postgres`, `game-replies-postgres`, `game-groups-postgres`,
  `game-service-postgres`, `game-routes` and `production-migration-guard`, plus
  typecheck, `pnpm complexity:diff` and `pnpm docs:drift`.
- Expected outcomes: all pass. Breaking any one of the key lines fails a named
  proof.
Completed: 2026-11-06
