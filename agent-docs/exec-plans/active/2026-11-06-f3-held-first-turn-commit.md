# Let a later message commit past a held first turn

Status: active
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and scope

- Outcome: a held first input no longer vetoes the commit probe when the same chat has a later member message; its exact real send remains blocked.
- Reaches: direct Linq replies after rejected retries. Lone held inputs, real sends, reaction/progress checks, sealed/reserved/answered rows retain their vetoes.
- Owner: derive the later-message witness in Web's existing mailbox scan and distinguish held egress in its existing resolver. No new state, query, decode, runner, schema, or infrastructure change.
- Proof: add route and real-PostgreSQL regressions, run red before implementation, then green, prepared Web typecheck and complexity diff.

## Tasks and decisions

1. Add deterministic proofs and capture the unchanged-source failures.
2. Make the three Web edits and update the four requested documentation owners.
3. Review scope and assertions; record commands, exits and line counts in [the result](../../../f3-held-first-turn-result.md).
4. Make one scoped local commit; no push or PR. Keep this plan active as explicitly requested.

The runner's current commit probe supplies check-only with no intent, idempotency key or purpose. Changed probe shape must restore the veto. Existing candidate ordering and message-edit handling remain unchanged. Live-model or full-stack changes are outside the requested Web-only proof; the deterministic boundary is the acceptance target.

## Verification and review

- Red: route 3 failures / 195 tests; corrected PostgreSQL 11 failures / 37 tests, all at the requested changed boundaries.
- Green: route 195/195 and PostgreSQL 37/37; prepared Web typecheck and complexity diff exit 0.
- Product UX: Ready for this Web boundary. Later-message commit probes pass; exact sends and all protected vetoes remain blocked. No model or provider delivery claim is made.
- Parent review: no extra query or decode; ordering, proactivity, state transitions, chat blockers, claim/abandonment and edit paths unchanged. No new persisted state.
- Plan intentionally remains active for the local-only handoff. See the result for the initial fixture correction and complexity refactor.
