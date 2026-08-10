# Challenge standings response card

Murph may present a current group-challenge snapshot as a native Messages card after it has scored the challenge through the existing managed challenge flow. The card is presentation only: the challenge knowledge page remains the sole durable challenge-state owner, and the deterministic challenge scorer remains the sole arithmetic owner.

## Supported presentations

- `individual`: ranked people.
- `teams`: ranked teams.
- `collective`: one shared total moving toward one target.

The response-card kind is `challenge_standings`, card version `1`, carried in Messages envelope schema version `4`. Individual and team cards contain at most eight already-sorted entries. Murph attaches a ranked card only when that limit fits the entire canonical result, including every waiting participant; it never truncates a ranking. Every format also requires the exact room-authorized labels and snapshot text to fit the closed schema and URL without shortening. Collective cards contain no per-person rows. Any capacity-partial shared read produces an ordinary-text incomplete update instead of a card for every format.

## Truthfulness rules

- `complete` means the displayed score is the currently supported score.
- `partial` means the displayed score is a verified lower bound and is rendered with `+`.
- `unscored` requires a null score and is rendered as waiting for data, never as zero.
- Ranked entries are descending by verified points and unscored entries are last. Ordinal ranks and ties are shown only when every entry has complete coverage; partial or unscored snapshots preserve the scorer order but label every row unranked.
- Collective cards require a positive target. Reaching a target with partial coverage is safe because the verified lower bound has already reached it.
- Internal entity ids, evidence paths, and tracking metadata are not embedded in the Messages URL.
- The V1 entry `detail` key is retained as null-only wire shape; per-person free text is not authorized for the group card.
- Title is the exact canonical room-facing challenge title. Subtitle and footer copy exact canonical room-facing challenge text or remain null; they never carry model-authored score, rank, coverage, missing-data, count, or arithmetic claims.
- Individual rows copy scorer-owned `verifiedPoints` and coverage.
- Team rows use `verifiedPoints` only when it is non-null. An incomplete average remains unscored even when a verified subtotal exists.
- Collective cards copy the scorer-owned complete, partial, unscored, and total participant counts. The counts must sum to the total, determine the coverage enum exactly, and render in the opened card and semantic fallback. Collective coverage is complete only when every participant is complete, unscored only when every participant is unscored, and partial otherwise. An all-unscored collective keeps points null rather than displaying zero.

## Delivery boundary

The response-card tool is available for this card in authenticated Linq group conversations, including exact scheduled challenge occurrences. Outside private direct conversations, runtime and outbox validation admit only `challenge_standings`; nutrition and workout cards remain private. Other group channels remain text-only until they have a native delivery contract.

The group response-card tool accepts the same normalized observation input as `score-challenge` plus exact room-facing presentation labels. It runs the deterministic scorer again and derives every point total, target, order, coverage state, coverage count, rank, and tie at the attachment boundary; the model cannot submit those derived values directly. The existing response-card pipeline then validates the closed card schema and emits semantic text for non-native routes.

The App Server turn owns one ephemeral capacity-omission latch. Once any shared read in that turn drops members to stay within the model-result ceiling, every later challenge-card attachment in the turn is rejected and the model can only complete with ordinary text. A later complete read cannot clear the latch; it resets with the next turn and is never persisted as challenge state.

Linq receives a complete static fallback layout plus a bounded `https://www.withmurph.ai/#murph-card=...` URL. The static layout carries the heading, every ranked row or the full collective score and coverage summary, lower-bound/rank qualifications, and the canonical footer when present. The value-free `fallback_text` remains free of dates and numbers so Messages does not demote the app card to an ordinary text bubble; recipients without the extension see the complete static layout. The URL must remain below 2,048 characters. The iOS Messages extension decodes that immutable snapshot offline; it does not fetch, score, reconcile identities, or persist challenge state.

Production follows `apps/cloudflare/DEPLOY.md` § Native iMessage Response-Card Rollout: deploy the Worker and runner together with `container_rollout=immediate`, then prove the exact runner-bundle fingerprint and assistant CLI surface before card traffic. The prior bundle is a safe rollback only before the first card-bearing value exists; afterward the new bundle is the hard rollback floor and recovery requires a coordinated forward fix.

## Non-goals

This card does not create a challenge, decide participants, verify evidence, calculate points, store a leaderboard, or refresh itself after delivery. A later update is a new immutable message snapshot produced from the canonical challenge state.
