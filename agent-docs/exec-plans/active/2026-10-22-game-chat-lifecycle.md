# Game chat lifecycle and shared discovery

## Outcome

Acceptance introduces the challenge through one contextual Murph message. The
same two players can discuss their canonical game in any verified room, while
one primary room remains the destination for app-originated announcements.

## Product UX

- Entry: accept or negotiate an invitation, propose a change in the app, or ask
  about the game in a room containing exactly both players and Murph.
- Promise: one natural introduction or proposal, truthful waiting/delivery
  state, and ordinary conversational agreement without duplicated templates.
- Affected journeys: reused and newly created rooms; duplicate same-pair rooms;
  app versus conversational proposals; retry after uncertain delivery; free
  participants; negotiating, live and settled games.
- Preserve exact audience verification, accepted-message actor authority,
  existing usage limits, proposal identity, and canonical game mutations.
- Reminders are offered, never scheduled by acceptance.

## Work and boundaries

- [x] Separate exact-pair authority from primary outbound destination.
- [x] Use model-authored app proposal instructions; conversational proposals
  stay in the current assistant turn with no second announcement.
- [x] Establish durable acceptance notification and generated first-message
  group creation through existing mailbox/outbox and provider receipt owners.
- [x] Extend included group access without multiplying the game allowance.
- [ ] Integrate canonical negotiation/terms and shared progress branches.
- [x] Focused deterministic tests, relevant typechecks, real-Codex journeys.
- [x] Update owner docs/changelog and prepare Draft PR #4313 for parent review.

Parent owns bootstrap architecture coordination and final review/deployment.
Related work owns negotiation/terms and shared progress/media; this branch does
not independently redefine those contracts.

## Verification

Source fixtures use synthetic identities and scenarios. No provider or
member-facing messages are sent by local proof. Focused routing/lifecycle
verification passed: 241 focused unit tests, 38 real PostgreSQL service/change
tests on a fresh fully migrated isolated database, Web typecheck and scoped
lint. Docs drift passes. Collaborators own additional bootstrap and allowance
proof recorded in the handoff: 189 bootstrap/route checks, 256 allowance units
and three PostgreSQL suites, 100 owner/prelaunch race checks, and 107 engine
notification plus 9 runtime/bootstrap checks. The aggregate complexity guard
passes without added debt. The allowance proof covers free pre-generation
bootstrap admission and server-frozen charging through lifecycle changes. Real local-subscription app and chat proposal journeys passed with one
concise request, correct total duration, no false restart, and no duplicate
announcement. The kickoff journey exposed weekday-number ambiguity and awkward
snapshot language; the shared production builder now explains Monday-based
weekday numbers, actual player Day 1 dates, and natural agreement wording.
Final kickoff plus contextual yes passed: one provider create, no duplicate
send, and a bare yes asks reminder time/duration without scheduling anything.
Final generated app proposal and conversational proposal journeys are Ready
on gpt-6.1-sol through the local subscription.

## Delivery and rollout decisions

Acceptance reserves the existing Linq receipt atomically with canonical events.
Initial invite negotiation reserves its ordinary app proposal receipt, with no
separate introduction. Chat-origin changes reserve no outbound notification.
One due intent plus one frozen receipt per minute bounds provider waits to
76 seconds inside a 180-second route budget. Unconsumed notification wake
recovery uses the same receipt; the generic preference sweep does not select
assistant notifications. Runtime/outbox owns consumed work.

New-room generation runs in a real group container. One frozen provider request
owns creation; later source changes cannot create a second group. Provider
acceptance and route-attachment completion are separate facts. The nullable
attachment marker and partial pending index deploy before Web. Compatible
hosted-execution parsers, runtime/engine handler and Web callback consumers deploy
before producers, and warm runtimes must refresh. Keep consumers and columns
through rollback until pending/frozen work drains.

This branch integrates the canonical terms branch; parent integrates the shared
progress/photo branch before a final candidate. Integration must preserve encrypted pending v2 words,
hydrate them before generated proposal context, retain host-only exact-pair
arguments for photo mutations, and preserve the new conversation delivery state.
A chat approval that activates negotiation gives only a brief acknowledgement;
the durable started kickoff owns the recap and reminder offer. Integration
proof must exercise this with the negotiating wire contract.
The shared allowance collaborator owns server-frozen funding attribution; no
alternate room creates a new included budget or personal AI access.
