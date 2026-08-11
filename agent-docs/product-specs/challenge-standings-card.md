# Challenge standings response card

Murph may present a current group-challenge snapshot as a native Messages card after it has scored the challenge through the existing managed challenge flow. The card is presentation only: the challenge knowledge page remains the sole durable challenge-state owner, and the deterministic challenge scorer remains the sole arithmetic owner.

## Supported presentations

- `individual`: ranked people.
- `teams`: ranked teams.
- `collective`: one shared total moving toward one target.

The response-card kind is `challenge_standings`, card version `1`, carried in Messages envelope schema version `5`. Individual and team cards contain at most eight already-sorted entries. Murph attaches a ranked card only when that limit fits the entire canonical result, including every waiting participant; it never truncates a ranking. Every format also requires the exact room-authorized labels and snapshot text to fit both the native fragment and static-image URL without shortening. Collective cards contain no per-person rows. Any unproven shared-read sequence produces an ordinary-text update instead of a card for every format.

## Truthfulness rules

- `complete` means the displayed score is the currently supported score.
- `partial` means the displayed score is a verified lower bound and is rendered with `+`.
- `unscored` requires a null score and is rendered as waiting for data, never as zero.
- Ranked entries are descending by verified points and unscored entries are last. Ordinal ranks and ties are shown only when every entry has complete coverage; partial or unscored snapshots preserve the scorer order but label every row unranked.
- Collective cards require a positive target. Reaching a target with partial coverage is safe because the verified lower bound has already reached it.
- Internal entity ids, evidence paths, and tracking metadata are not embedded in the Messages URL.
- The V1 entry `detail` key is retained as null-only wire shape; per-person free text is not authorized for the group card.
- The title leads the visible card directly. Format labels and per-row coverage labels are omitted; incomplete ranking is explained once after the list, while partial scores remain marked with `+` and unscored values remain `—`.
- Title is the exact canonical room-facing challenge title. Subtitle and footer copy exact canonical room-facing challenge text or remain null; they never carry model-authored score, rank, coverage, missing-data, count, or arithmetic claims.
- Individual rows copy scorer-owned `verifiedPoints` and coverage.
- Team rows use `verifiedPoints` only when it is non-null. An incomplete average remains unscored even when a verified subtotal exists.
- Collective cards copy the scorer-owned complete, partial, unscored, and total participant counts. The counts must sum to the total, determine the coverage enum exactly, and render in the opened card and semantic fallback. Collective coverage is complete only when every participant is complete, unscored only when every participant is unscored, and partial otherwise. An all-unscored collective keeps points null rather than displaying zero.

## Delivery boundary

The response-card tool is available for this card in authenticated Linq group conversations with a trusted shared reader, including exact scheduled challenge occurrences. Outside private direct conversations, runtime and outbox validation admit only `challenge_standings`; nutrition and workout cards remain private. Other group channels remain text-only until they have a native delivery contract.

The group response-card tool accepts only the canonical challenge-page slug and normalized participant-component observations. The existing page must have `pageType: challenge` and exactly one closed `murph:group-challenge-definition:v1` section. That definition owns `rulesRevision`, the ordered participation roster and states, format, objective, teams, scorecard components, evaluation rules, projection scopes, settlement modes, units, rates, and caps. The host starts from every page participant whose state is `in`, orders observations to match the page, and rejects any missing, extra, duplicate, or structurally invalid observation. Current room membership or a sharing grant never creates challenge buy-in.

The host projects the definition and observations into the existing deterministic scorer and derives every point total, target, order, coverage state, coverage count, rank, and tie at the attachment boundary; the model cannot submit structural challenge rules or derived values to the effect. Individual labels come only from the trusted shared read, in scorer/page order, the title comes only from the existing challenge page, and V1 subtitle and footer remain null. The existing response-card pipeline then validates the closed card schema and emits semantic text for non-native routes.

The App Server turn owns one ephemeral shared-read proof. Every attempted scoring read contributes its trusted canonical scope keys and must return the same nonempty ordered current-room-member and authorized-label roster. An unavailable, failed, empty, capacity-omitted, duplicate-participant, roster-changed, or label-changed result invalidates the proof for the rest of the turn. Attachment requires at least one successful batch, every page-owned `in` participant to be present in that trusted roster, and every definition-owned component scope to be backed by those successful reads. Additional current room members remain nonparticipants; scorer/page order owns card order.

After those checks, the attachment effect compare-and-set upserts one machine-readable snapshot containing the page-derived normalized input, `rulesRevision`, deterministic result, component scope mapping, and trusted read batches onto the existing challenge page. Persistence completes before the card is attached. A missing or generic page, missing or malformed definition, malformed prior snapshot section, concurrent page change, or write failure leaves ordinary text available and attaches no card. An unstructured legacy challenge page remains usable through ordinary text but is not eligible for the optional native card. This is not a second leaderboard: the existing challenge page remains the only durable owner, and the proof itself resets with the turn.

Linq receives complete semantic captions, a generated image fallback, and a bounded `https://www.withmurph.ai/#murph-card=...` URL. The captions carry the exact heading, every ranked label and row or the full collective score and coverage summary, lower-bound/rank qualifications, and the canonical footer when present. The native fragment preserves that complete room-authorized snapshot. Before building the public queryless image URL, the producer derives an identity-free schema-V5 presentation: the title becomes `Challenge standings`, subtitle and footer become null, and ranked labels become stable `Participant N` or `Team N` labels while scorer-owned order, scores, coverage, target, and collective counts remain unchanged. The resulting image preserves the native hierarchy without exposing participant, team, or challenge names and without adding format or per-row coverage labels. It remains rectangular because Messages owns the outer chrome, while the bitmap embeds the checked-in canonical Murph mark in the native 36×27pt upper-left badge footprint and places the title beside it in the shared fallback header. The value-free `fallback_text` identifies challenge standings and tells the member how to request the complete semantic text while remaining free of dates and numbers so Messages does not demote the app card to an ordinary text bubble. The native fragment and queryless image URL must each remain below 2,048 characters. The image route accepts only the exact bounded schema-V5 envelope, reads no database or remote service, and returns private no-store/no-index headers. The iOS Messages extension decodes the immutable fragment offline; it does not fetch, score, reconcile identities, or persist challenge state.

Production follows `apps/cloudflare/DEPLOY.md` § Native iMessage Response-Card Rollout: deploy the compatible iOS reader first, the Web image route second, then the Worker and runner together with `container_rollout=immediate`; prove the exact runner-bundle fingerprint and assistant CLI surface before card traffic. The Web route must remain available while a sent image URL may still be fetched. The prior bundle is a safe rollback only before the first card-bearing value exists; afterward the new bundle is the hard rollback floor and recovery requires a coordinated forward fix.

## Non-goals

This card does not create or repair a challenge definition, decide participants, interpret raw evidence, create a second leaderboard, or refresh itself after delivery. It verifies the page, trusted read, and persistence boundaries, runs the existing scorer, and records the resulting snapshot on the existing challenge page. A later update is a new immutable message snapshot produced from that canonical challenge state.
