# Game reactions and combined asks

Extend PR #5040 with Linq like/heart agreement and complete multi-field game asks.
Keep the earlier-message authority change, one 24-hour server limit, and existing
actor, route, proposal and transaction owners. No new flags or tables.

## Work

- Trace reaction ingestion, attestation, acceptance and game authority; distinguish
  Telegram's context-only reactions. Inspect combined-edit validation.
- Let the generic reaction classifier escalate agreement and defer consent to
  tool rules. State game reaction, combined ask and replacement rules once.
- Prove reactor identity, accepted inputs, safe exclusions, combined fields,
  pending-ask replacement and locked-field recovery with focused tests and live
  synthetic journeys. Review full composed guidance and provider input impact.
- Update the game contract, changelog and PR result body; run diff-scoped checks,
  commit and push this branch, then verify required CI. Do not merge or deploy.
- Skip ReviewGPT at the user's explicit request; the owner will run that loop.

## Product journeys

Asked player likes/hearts the exact waiting ask or invitation: count their yes and
confirm the result briefly. Asker, bystander, unrelated, negative or question
reaction: no approval. Several requested fields travel in one ask. An addition
to one's own waiting ask retains earlier fields; the other player's counteroffer
replaces them. A locked field leaves all terms unchanged; explain the refusal
and propose the requested fields that are still allowed.

## Evidence

Implemented in the classifier, generic reaction turn context and game tool rules.
No new ingress code was needed. Linq's reactor-owned synthetic
message carries its native target and is accepted in group turns after exact
sent-delivery attestation. The existing sender resolver maps the reactor's
handle, ignoring transport attribution. Telegram reactions use the consumed
context mailbox and do not trigger this path.

Final path review found that a game chat's first message bypassed the outbox,
so reactions to that message failed attestation. The accepted Web receipt now
creates a terminal outbox entry through the existing intent owner. It never
queues a resend; the receipt key deduplicates recovery. Normal notification
delivery passes its turn ID and completed recovery reads the existing entry.
The old runtime did not record these opening messages in the outbox; this does
not backfill already completed historical deliveries.

Combined edits already preserve all parsed fields and validate atomically. The
existing task lock rejects the entire request; a reduced schedule-only proposal
is allowed. Existing proposal/resolution/actor keys are independent of message
refs. Cloudflare outbound policy, runtime group-tool forwarding, signed Web
route and group dispatcher add no current-turn-only gate for game origins.

Focused checks (explicit exit codes):

- Engine game/reaction/auto-reply: 268 tests, exit 0; includes direct/group
  reaction target attestation and accepted input identity.
- Instruction budgets: 12 tests, exit 0. After naming gameId in the reaction
  rule, game tools plus budgets: 117 tests, exit 0.
- Web chat actor, Linq adapter and combined rules: 127 tests, exit 0. The
  synthetic wake initially missed its required contact key (exit 1); fixed.
- Changelog archive and game changes: 47 tests, exit 0 (4 archive tests).
- Engine and Web typechecks: exit 0. Web initially exited 2 for a widened
  weekday fixture; corrected the literal types.
- Complexity: exit 0, no new debt; existing reply-function hotspots unchanged.
- Docs drift: exit 0 after updating the index (initial exit 1).
- Credential-free complete game inputs: 3 tests, exit 0. Direct request
  123509 bytes unchanged; group 159172 to 159569 (+397, +0.249%); after-read
  group +1755 and mixed +1724. Exact model tokenizers unavailable.
- Classifier measurement: exit 1 on an existing native-tool assertion. A
  temporary diagnostic retained that assertion and captured 14557 to 14623
  bytes (+66), with identical native declarations at base and candidate.
  Logged with Frog; no capability assertion weakened. Generic reaction context
  grows 44 authored bytes, separately from complete-request measurements.

Live synthetic journeys use production builders and real dynamic-tool parsing
with GPT-6.1 Sol on the local subscription, ambient configuration. Combined
pair/group asks, own-ask cancellation and merge, another player's counteroffer,
locked-task recovery, likes/hearts, own and unrelated likes, negative/question
reactions, and invitation like all passed with exact effect counts and refs.
The first like run attempted approval without gameId before correcting itself
(exit 1); the production instruction now names gameId and the rerun passed
without relaxing assertions. Priority Luna's 27-case classifier journey passed,
including a heart on an agreement ask, with no fallback.

All 15 game journeys and the 27-case classifier eval passed (each command exit
0), including the three earlier-message regressions. The final reactor fixture
uses the real sender resolver and ignores misleading transport attribution:
55 Web authority tests passed again (exit 0). The initial addendum diff run
loaded old prompt text before a concurrent edit and exited 1; its rerun passed
6302 engine tests before being stopped (exit 130) for the opening-message fix.
That fix's real-storage bootstrap, notification, auto-reply and outbox suites
pass 431 tests (one skip), exit 0. Engine typecheck, docs drift and complexity
pass, exit 0; outbox complexity debt decreases by two. Initial fixture/mock
assumptions failed (tests exit 1, typecheck exit 2), then were corrected. The
first complexity run exited 1; deriving the initial state once removed the
repeated branches. A final diff-scoped rerun covers the complete candidate.
The same PR result body holds its final result and exact-head CI status. Prior
24-hour work and PostgreSQL evidence remain in the completed 2026-11-15 plan.
Product UX: Ready for the journeys completed above; no known implementation gap.

Deployment: Web's 24-hour guard must precede the protected manual Cloudflare
runtime deploy. The classifier, reaction context and game guidance also require
that runtime deploy. No deployment, merge or ReviewGPT run is authorized here.
Status: completed
Updated: 2026-11-16
Completed: 2026-11-16
