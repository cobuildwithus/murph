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
- [x] Integrate canonical negotiation/terms and compatible runtime readers.
- [ ] Parent integrates shared progress/photo branch.
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

## Combined negotiation proof

The branch merges the canonical negotiation head and compatible runtime-reader
floor. Proposal context now hydrates encrypted v2 words through the canonical
reader. Queued and sent updates change only delivery metadata, preserving sealed
terms. The stored parser preserves app/chat origin and conversation delivery
state. Initial invite negotiation reserves only the ordinary proposal; approval
reserves exactly one started kickoff, including concurrent approval retries.

Combined verification passed: 47 PostgreSQL service/change/negotiation tests;
88 focused lifecycle, bootstrap, proposal and contract tests; Web and engine
typechecks. The sealed task/stake notification regression proves generated
context receives public proposed words, while its update leaves encrypted
storage intact. The real negotiation-approval journey is Ready: read once,
approve the exact pending ID once, and briefly acknowledge active agreement
without a repeated task/stake introduction, reminder offer or false delivery
claim. Its first assertion omitted the valid wording “agreement is recorded”;
the assertion now recognizes that acknowledgement without relaxing effect or
privacy checks. No production prompt change was needed for that evidence.
The source metadata parser was factored to preserve the complexity ceiling.

## Round 1 remediation

Both accepted findings are corrected. A skipped pre-generation reservation now
returns terminal unavailable only when its lifecycle source, original template,
container owner and lack of provider evidence prove that no message froze. A
real PostgreSQL journey uses canonical negotiation/cancellation, actual mailbox
publication and the lifecycle sweep, then successfully queues and sends one
replacement in the same route-less container. The engine's unavailable-to-skip
proof and an actual serialized runtime mailbox test show that the old wake
finishes and its successor runs. Existing session-continuity coverage remains.

New generated text runs the transport-owned first-message validator before line
capacity or frozen dispatch claims. The provider entry reuses that exact helper.
Inline links, plain HTTP links, URL-only and multiple-link outputs leave no
frozen payload or capacity claim; retry with valid generated text creates and
attaches one room. Uncertain provider effects still replay identical frozen text
and identity. The formatter receives the actual opening-message link constraints;
canonical game words are never rewritten. Test KMS and provider ports remain
synthetic; the database/mailbox/receipt/route owners are real in the PostgreSQL
journey. Runtime queue ordering is verified separately through its production
state owner, with existing engine terminal-result coverage at the boundary.

Remediation verification: 113 Web bootstrap/lifecycle/transport tests, one
composed PostgreSQL recovery journey, one serialized runtime queue regression,
and four engine bootstrap boundary tests passed. Web, engine and runtime
typechecks, scoped lint, docs drift and complexity passed. The real local-Codex
linked-task kickoff and contextual yes journey is Ready: one create, one model
turn, no ordinary duplicate send, no inline URL, unchanged canonical task link,
and a follow-up asking for reminder time/duration. The existing date assertion
was corrected to accept the actual first date plus seven calendar days as well
as an explicit date range; no start-date, link, delivery or consent guarantee was
relaxed. The separate CI remediation adds exact migration admission and fixes
existing game-access fixtures; its owner reports 414 passing focused tests and
local PostgreSQL old-writer compatibility proof.


## Final review and handoff

Round 2 full sensitive ReviewGPT returned PASS at
`ba8f3363e6693264a11a937dac19a4812b3df6e8`; both accepted High findings are
resolved at the existing owners. The exact committed turn, one guarded snapshot,
and GPT-6 Pro sent-model selection were verified in the Eragon lane. Response
arrived after approximately five minutes, exceeding the three-minute minimum.
The review inspected all 75 patch files and confirmed cancelled-empty reservation
terminalization, pre-freeze validation, canonical consent, room/session authority
and shared allowance attribution. It did not rerun the supplied local suites.

Review: https://chatgpt.com/c/6ada3d26-45b0-83e9-b764-0b660e196c8d

Implementation and focused proof are complete. The parent owns exact-head CI and
the aggregate writer release in PR #4311. Compatible runtime floor #4312 is merged;
its protected deployment stopped before upload at the existing Images account
admission check. Successful compatible runtime convergence remains required before
merging writers. This plan closure records completed implementation, not deployed
production behavior. No member message or production-data mutation was performed.
Status: completed
Updated: 2026-10-22
Completed: 2026-10-22
