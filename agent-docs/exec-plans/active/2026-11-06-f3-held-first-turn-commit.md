# Let a later message commit past a held first turn

Status: active
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and scope

- Outcome: a held first input no longer vetoes the commit probe when the same chat has a later member message; its exact real send remains blocked.
- Reaches: direct Linq replies after rejected retries. Replies aimed at a held input with a later member message end as superseded; lone held inputs, reaction/progress purposes and sealed/reserved rows keep retryable vetoes. Answered rows keep their existing terminal result.
- Owner: derive the witness only after Web resolves a held row, using the existing bounded mailbox readers and shared decoder. Normal sends keep the base scan shape, queries and decodes. No runner, Worker, Temporal, schema, migration or infrastructure change.
- Proof: add route and real-PostgreSQL regressions, run red before implementation, then green, prepared Web typecheck and complexity diff.

## Tasks and decisions

1. Add deterministic proofs and capture the unchanged-source failures.
2. Make the three Web edits and update the four requested documentation owners.
3. Review scope and assertions, and record commands and exit codes in the PR evidence.
4. Add the full-stack `linq-first-turn-held` proof, then PR, review and CI.

The runner's current commit probe supplies check-only with no intent, idempotency key or purpose. A held-input non-probe with a later member message and no delivery purpose uses the existing `HOSTED_LINQ_INSTANT_FIRST_TURN_ALREADY_ANSWERED` 409, non-retryable contract. Older runners recognize it as terminal supersede, with no retry, failure-recovery input or recovery wake. A later native reply or message arriving during the held turn need not join that turn, so passing its probe does not authorize sending its reply.

The original scan's answered IDs put E1 first on real sends and hide the witness. Restore that scan to its base behavior. The held-only helper reads newest first with empty answered IDs, shares decoding inside the root-unwrap cache, stops at the held source event and fails closed if absent. This adds one bounded recent-items query and at most one batched sidecar query only for held rows, with at most 100 decoded candidates; it adds no query or decode to normal sends. Edit events retain their own source reference and do not inherit E1's held row.

Existing candidate ordering and message-edit handling remain unchanged. Live-model or full-stack changes are outside the requested Web-only proof; the deterministic boundary is the acceptance target.

## Verification and review

- Original red: route 3 failures / 195 tests; corrected PostgreSQL 11 failures / 37 tests, all at the requested changed boundaries.
- Original green: route 195/195 and PostgreSQL 37/37; prepared Web typecheck and complexity diff exit 0.
- Original Product UX: Ready for this Web boundary. Later-message commit probes pass; exact sends and all protected vetoes remain blocked. No model or provider delivery claim is made.
- Original parent review: no extra query or decode; the follow-up above supersedes the original witness placement and real-send retry contract. Ordering, proactivity, state transitions, chat blockers, claim/abandonment and edit paths remain unchanged. No new persisted state.
- Follow-up red: route 19 failures / 201 tests, including answered-E1 probe 503 instead of 200 and exact reply/intent/idempotency checks 503 instead of terminal 409. Held-only query-count assertions also fail on the original scan. PostgreSQL 7 failures / 38 tests because the new helper is absent; the other 31 disposition tests pass.
- Follow-up green: route 201/201, PostgreSQL 38/38, prepared Web typecheck and complexity diff all exit 0. Normal absent/sealed real sends retain two candidate queries, zero sidecar queries, one decode and one unwrap-cache scope for the inline fixture. The edit route selects its own source and passes without inheriting E1's held row.
- Follow-up Product UX: Ready for the Web boundary. Exact held replies with a later message are terminal before provider dispatch; lone held inputs and reaction/progress purposes remain retryable. Existing outbox code classifies the terminal code as abandoned and excludes it from failure recovery; no runner or live-provider proof was added in this Web-only follow-up.
- Follow-up completion remains local and scoped; keep this plan active for the existing full-stack/PR lane.
