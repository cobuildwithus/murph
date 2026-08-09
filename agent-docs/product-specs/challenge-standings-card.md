# Challenge standings response card

Murph may present a current group-challenge snapshot as a native Messages card after it has scored the challenge through the existing managed challenge flow. The card is presentation only: the challenge knowledge page remains the sole durable challenge-state owner, and the deterministic challenge scorer remains the sole arithmetic owner.

## Supported presentations

- `individual`: ranked people.
- `teams`: ranked teams.
- `collective`: one shared total moving toward one target.

The response-card kind is `challenge_standings`, card version `1`, carried in Messages envelope schema version `4`. Individual and team cards contain at most eight already-sorted entries. Collective cards contain no per-person rows.

## Truthfulness rules

- `complete` means the displayed score is the currently supported score.
- `partial` means the displayed score is a verified lower bound and is rendered with `+`.
- `unscored` requires a null score and is rendered as waiting for data, never as zero.
- Ranked entries are descending, ties are derived from equal points, and unscored entries are last.
- Collective cards require a positive target. Reaching a target with partial coverage is safe because the verified lower bound has already reached it.
- Internal entity ids, evidence paths, and tracking metadata are not embedded in the Messages URL.
- Individual rows copy scorer-owned `verifiedPoints` and coverage.
- Team rows use `verifiedPoints` only when it is non-null. An incomplete average remains unscored even when a verified subtotal exists.
- Collective coverage is complete only when every participant is complete, unscored only when every participant is unscored, and partial otherwise. An all-unscored collective keeps points null rather than displaying zero.

## Delivery boundary

The response-card tool is available for this card in authenticated Linq group conversations, including exact scheduled challenge occurrences. Outside private direct conversations, runtime and outbox validation admit only `challenge_standings`; nutrition and workout cards remain private. Other group channels remain text-only until they have a native delivery contract.

The existing response-card tool validates the closed schema and emits semantic text for non-native routes. Linq receives a static fallback layout plus a bounded `https://murph.ai/#murph-card=...` URL. The URL must remain below 2,048 characters. The iOS Messages extension decodes that immutable snapshot offline; it does not fetch, score, reconcile identities, or persist challenge state.

## Non-goals

This card does not create a challenge, decide participants, verify evidence, calculate points, store a leaderboard, or refresh itself after delivery. A later update is a new immutable message snapshot produced from the canonical challenge state.
