# Group consent repost and restaurant nutrition resolution

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Let a hosted iMessage group explicitly request a fresh native join-and-share
  consent message even when an older matching offer remains active.
- Make named restaurant meal logging resolve nutrition before the meal write,
  using the existing food database first and an official restaurant source only
  when the database cannot identify the item.

## Root cause

- The model-facing group tool advertised an accepted-message reference, but the
  strict `offer_access` parser rejected that field. The lower Web owner then
  reused any matching active offer indefinitely, so a later resend request had
  neither an accepted contract nor a provider-send identity.
- The food-journal skill contained the correct source precedence, but the
  restaurant path was buried after the low-friction mutation guidance and had
  no focused real-model journey. A turn could therefore save a nutrition-free
  meal before attempting the required lookup.

## Architecture

- Reuse the existing accepted-input authority as the explicit repost identity.
  Assistant Engine validates the exact current Message ref and maps it to the
  lower `post_join_offer` request. Web reads the locked current policy snapshot,
  includes the request identity in provider idempotency, posts one replacement,
  and revokes older matching offers only after the new message is durably bound.
  Reposting never creates or changes a group policy. Ordinary offers keep the
  existing covering-offer reuse behavior.
- Keep restaurant resolution in the existing food-journal policy and existing
  CLI/browser primitives. Move the lookup-before-write invariant to the capture
  path, state the database-miss official-source fallback explicitly, and add
  deterministic plus real-Codex regression proof. Add no resolver service,
  persistence owner, queue, dependency, or meal schema.

## Product UX journeys

- Effort: Patch.
- Outcome: explicit consent-message resend requests post a fresh native prompt,
  and recognizable restaurant meals are saved with grounded nutrition.
- Reaches: existing hosted-group join consent and private meal-capture journeys.
- Proof: provider-shaped replacement/replay tests plus focused real-Codex
  journeys with inspected effects and replies.

- A room participant asks in the current message to resend a join prompt: one
  new native prompt is posted and the assistant does not falsely claim a
  link-only fallback.
- The exact same accepted request replays: provider idempotency and the durable
  binding converge on the same prompt without a duplicate effect.
- A normal repeated offer without an explicit repost request: the existing
  active prompt is reused and the first-party link remains available.
- A private member names a restaurant and recognizable menu item: Murph searches
  the existing food-label database before saving, records source-labeled
  nutrition, and asks only about a materially different variant.
- The database has no exact restaurant match: Murph checks an official
  restaurant source before using a clearly labeled estimate; unavailable
  evidence stays truthful and does not become invented exact nutrition.
- A number-sensitive or eating-disorder-risk context: the existing safety
  exception continues to suppress unsolicited numeric estimates.

## Tasks

1. [x] Add the request-bound consent repost contract across Assistant Engine,
   hosted transport, Web, and focused tests.
2. [x] Clarify the restaurant lookup-before-write contract and add deterministic
   and focused real-Codex coverage.
3. [x] Run focused tests, package typechecks, actual-reply review, Product UX
   replay, privacy inspection, and candidate diff review.
4. [x] Commit and push the candidate, open the draft PR, and start the required
   specialist and final ReviewGPT passes concurrently with exact-head CI.
5. [ ] Resolve accepted findings, run ReviewGPT round two, archive this plan
   with `scripts/finish-task`, and confirm the final PR head is green.

## Verification

- Assistant Engine group-tool parser/authority tests and real-Codex journeys.
- Hosted Execution and Assistant Runtime request/parser/context tests.
- Web group-store/group-tool replay and replacement tests.
- Food-journal prompt tests and real-Codex restaurant logging journey.
- Assistant Engine, Hosted Execution, Assistant Runtime, and Web typechecks.
- `git diff --check`, privacy-sensitive diff inspection, exact-head CI, and
  required ReviewGPT gates.

## Local evidence and Product UX walkthrough

- Consent requester: the focused real-Codex group journey issued one native
  offer call with the exact current Message ref and lowered one request-bound
  repost. Deterministic Assistant Engine, transport, runtime, store, and Web
  tests prove wrong-ref rejection, immutable current-policy reposting, ordinary
  active-offer reuse, request-distinct replay-stable provider idempotency, and
  revoke-after-binding replacement order.
- Restaurant member: focused real-Codex journeys cover both an exact synthetic
  menu database hit and a database miss followed by the restaurant's synthetic
  official nutrition page. Both save after sourcing, preserve valid provenance,
  and do not ask the member to repeat the item. The production-shaped fixture
  rejects generic restaurant queries and unsupported meal fields.
- Existing exclusions: deterministic food-journal coverage preserves the
  official-source fallback and existing number-sensitive safety exception.
- Regression proof: Assistant Engine completed 4,133 tests, Assistant Runtime
  2,516 tests, Hosted Execution 560 tests, focused Web consent coverage 247
  tests, and all four affected package typechecks passed.
- Provider input: normalized complete first-request captures for representative
  direct and group turns were byte- and token-identical at base and head. The
  changed group schema stays deferred until tool discovery; the meal skill stays
  deferred until selected.
- Walkthrough result: **Ready**. Both existing journeys reach their promised
  observable result, failure preserves the prior working consent offer, and
  there were no differences from the Patch plan.

## Deployment concerns

- The repost field is additive. Deploy Web before the hosted runtime so old
  runners continue their ordinary no-field behavior while the new producer
  waits for a consumer that understands request-bound reposting.
- The food-journal change is prompt-only at runtime and has no cross-service
  skew requirement.
