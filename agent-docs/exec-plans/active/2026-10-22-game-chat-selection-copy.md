# Game chat selection and proposal wording

## Outcome

Game proposals distinguish a duration edit from moving the start date. Initial
chat discovery prefers recent conversation activity, then a nonblank group name,
then room creation date, among rooms with the same players.

## Scope and invariants

- Keep the existing game, participant, route, provider roster and notification
  owners. Preserve bounded discovery and exact current audience verification.
- Never silently move a game already bound to a room. Diagnose existing bindings
  read-only; production repair is separate from this change.
- Keep duration measured from the original start and preserve prior check-ins
  and weekday rules. Only explicit start edits describe a new game start.
- Kickoff messages and unlinked-game tool discovery remain follow-up discussion.

## Product UX

Outcome: concise proposals name the requested change, and reach the established
shared conversation when multiple exact-pair rooms exist.
Reaches: duration-only, schedule-only, combined, start-now and future-start
proposals; named/unnamed candidates, activity ties, changed provider audiences,
already-bound rooms and new-room fallback.
Proof: production formatter/outbox assertions, synthetic candidate selection and
provider checks, focused assistant journey where applicable, Web typecheck and
lint. No member messages or production mutations during verification.

## Steps

- [x] Trace proposal dates and candidate ordering; inspect scoped read-only facts.
- [x] Rephrase proposals and rank bounded candidate rooms.
- [x] Add focused regression proof and run relevant checks.
- [ ] Review diff, update owner documentation and changelog, scoped commit.

## Evidence

The duration decision stores no start-date edit; ambiguous wording labels the
first unstarted terms day as a start. Candidate discovery orders by room creation
and stops on the first verified pair, ignoring conversation activity and group
names. Private diagnostic rows remain outside repository artifacts.

Routing now derives activity from the latest accepted `conversation.message`
mailbox receipt using the existing member/kind/created-at index. Roster refreshes
and system notifications cannot promote a room. Discovery remains capped at 20
rooms, all selected audiences require fresh exact provider verification, and
bound games do not move. Synthetic delivery regressions cover activity before
name, name before creation, absent activity, blank names, creation ties, provider
audience rejection, and the discovery bound.

## Verification

- Web delivery, changes and delivery-authority suites: 46 tests passed.
- Delivery plus public changelog rendering: 41 tests passed.
- Web and assistant-engine typechecks passed. Scoped Web lint passed; engine
  fixture lint has only existing unrelated warnings.
- Complexity diff passed with no functions above 20 and unchanged maximum 19.
- Two focused real-Codex journeys passed using gpt-6.1-sol and local subscription
  auth: ordinary agreement to a duration extension and to a weekend schedule.
  Each called read_game then update_game exactly once; reviewed replies were
  concise and accurate. Product UX verdict: Ready for candidate review.
- The initial live discovery attempt encountered pnpm engine-warning output;
  silent logging restored structured enumeration. The default subscription
  was blocked before provider action; the documented alternate-home lane passed.
- Proposal text is delivered by the existing exact-text notification branch;
  no model-generated proposal, new provider input, or additional delivery owner.

The candidate query explicitly uses Prisma's join relation strategy. Local
PostgreSQL generated-SQL and EXPLAIN ANALYZE proof used two synthetic rooms with
500 message rows each inside a rolled-back transaction: the existing mailbox
index returned one row per room (rows=1, loops=2) beneath LIMIT 1. Ranking does
not load conversation histories into application memory.

Implementation candidate and remaining review/release evidence: PR #4293.
