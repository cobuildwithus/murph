# Weekly game changes agreed in chat

Status: active
Created: 2026-10-21

## Outcome

Players propose Start now or schedule, duration and pre-start date edits from the
native game. Reuse their exact existing shared chat, or create one automatically.
The initiating tap records one player's agreement; Murph interprets the other
player's ordinary reply and applies the agreed change through the game service.

## Invariants and ownership

- Game rows and versioned terms remain canonical. One pending structural proposal
  is serialized under the game lock; its stable id is retained in game events.
- Existing days, check-ins and misses retain their rules. Count-mode schedules
  cannot be reinterpreted mid-game. Delayed approval cannot rewrite a started day.
- Routing uses verified identities and live exact provider rosters, never private
  labels. Chat tools omit private labels, entries, photos and invite tokens.
- Existing delivery admission/outbox and provider idempotency own effects. Crypto
  and provider work run outside database transactions. No live member messages
  are sent during development verification.
- Group access can come from an eligible live two-player game, without granting
  the players personal AI access. Suspension and consent withdrawal still win.

## Implementation

1. Add structural pending proposal and chat association; thin app route and pure
   change rules; shared chat projection.
2. Reuse/provision exact chat and deliver a single proposal through existing
   provider/delivery owners.
3. Add discoverable read_game/update_game through signed group tool transport,
   with accepted input attribution and transaction-time authority revalidation.
4. Integrate native UI against additive wire fields (separate native repository).
5. Focused rule, route, service PostgreSQL, transport, runtime and real-Codex proof;
   parent candidate review; ReviewGPT concurrent with exact-head CI; merge and
   deployment owned by the original session.

## Product UX journeys

- Existing group, first proposal; no group, automatic creation.
- Proposer tap, natural agreement, decline/cancel, repeated tap, simultaneous
  proposals, stale approval after the next day starts.
- Weekday-to-weekend future edit preserves a completed weekday's score/miss.
- Free players can agree in the shared group without a personal subscription.
- Failed/ambiguous delivery stays truthful and cannot duplicate a group or send.

## Verification

Implementation and focused proof complete; draft PR, external review and exact-head
CI remain. No production rollout claimed.

- Web typecheck, assistant-engine/runtime/hosted-execution/Cloudflare typechecks,
  focused game rule/route/service/authority tests, migrated local PostgreSQL
  transaction and access proofs, changelog rendering, lint and complexity pass.
- Real Codex ordinary-agreement journey: exactly read_game then one approval;
  concise truthful confirmation, UX Ready. Synthetic local subscription only.
- Complete provider request capture: individual 155921 bytes unchanged; group
  130694 to 136129 bytes (+5435, +4.15857%). Exact model tokenizer unavailable;
  token counts are unmeasured. Physical SQL totals across inherited auth/crypto
  helpers are unmeasured; bounded owners and peak transaction count reviewed.
- Parent review corrected owner-before-game lock order, free group eligibility,
  exact current pair filtering, canonical terminal delivery recovery, feature
  gates and future-day scoring. No private-view read remains in runtime writes.

