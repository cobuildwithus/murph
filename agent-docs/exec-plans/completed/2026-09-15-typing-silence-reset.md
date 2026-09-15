# Measure typing silence after accepted replies

Status: completed
Created: 2026-09-15

## Outcome and owner

Replace the Linq alert query's blanket same-chat activity exclusion with a
silence start derived from existing accepted deliveries and prior typing
sessions. Keep the existing trace, mailbox, and blinded chat correlation owners.
No new persistence, dependencies, or member reply behavior.

## Contract and Product UX

Internal operator patch. A same-chat reply resets the silence clock for an
unanswered input. Prior typing covers arrival only until its linked reply or
five-minute expiry; resumed silence is measured from that endpoint. An accepted
reply linked to this exact input completes its wait. Other-chat activity, failed
sends, and future activity cannot reset the clock. Keep warm/cold thresholds,
missing-telemetry grace, usage exclusions, deduplication, and Telegram behavior.
Alert emails distinguish webhook receipt from the measured silence start.

## Tasks and proof

1. Reproduce a reply followed by an over-threshold typing gap in PostgreSQL.
2. Derive silence timing at the query owner and update frozen alert text.
3. Cover reset boundaries, prior-session completion/expiry, missing typing,
   answered inputs, repeated sends, cold thresholds, isolation, and email recovery.
4. Run focused PostgreSQL/email/store tests, Web typecheck/lint, complexity guard,
   parent review, then update PR 3487 and run round 2 ReviewGPT with exact-head CI.

## Risks and simplification

Derive timing in the existing bounded query using indexed ledgers. Do not add a
second timer or queue. Preserve old frozen alert bodies during deploy skew by
rendering legacy records without the new silence-start field as before.

## Verification

- Regression before the change: expected five resumed-silence alerts, received none.
- PostgreSQL alert and concurrency suites, alert-email and cron suites: 27 passed.
- Final materialized-query change: all eight PostgreSQL alert cases passed again.
- Web typecheck, focused ESLint, diff whitespace and complexity guards passed.
- Parent review: Ready. The existing query derives each candidate's activity once;
  exact-input reply completion uses the existing delivery link. No new timer owner.
- Email proof covers reset timestamps and measured duration; legacy frozen alerts
  preserve their original text. No member-facing changelog or real-Codex journey
  applies to this operator-only correction.
- Round 2 ReviewGPT and exact-head CI remain PR completion gates; their results
  belong in PR evidence. No merge or production deployment is included.
Updated: 2026-09-15
Completed: 2026-09-15
