# Set up a two-player game in chat

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Outcome and invariants

Either signed sender in an exact two-member room can ask for a complete game;
the other person agrees before any obligations begin. Both see the ordinary
native game. Existing games, private labels, authority, moderation, pair cap,
chain rules and durable kickoff remain owned by the current game service.
Work ends at a verified local commit: no push, PR, deployment or production access.

## Inventory and parity

| App option | Chat representation | Existing validation/owner |
| --- | --- | --- |
| Opponent | Other member in provider-verified exact pair | requireExactGameChat, signed sender |
| Tasks, same or different | Two task texts keyed by memberId from marked read_game player references; server assigns creator seat 0 | parseGameCommand, decideNewTerms, moderation |
| Every day / named weekdays / any N days | schedule.days (Monday 0) or schedule.count over whole game | validSchedule; count cannot exceed duration |
| Duration | lengthDays, 3–365, default 7 | parseGameCommand, decideNewTerms |
| Day 1 | startsOn tomorrow through 60 days out, or omitted acceptance default | decideNewTerms, acceptanceStartDate, firstScheduledDate |
| Today | Default acceptance may start today between 03:00 and 20:00; never promise until accepted | decideJoin |
| Start now | Existing start_now change when offered; other player's approval | gameChangeControls, decideApprovedGameChange |
| Prize / dare | Exactly one prize for winner or dare for loser, words 1–200 characters | validNewStakes, parseGameCommand, moderation |
| Legacy winner_gets / per_miss | Read only, no new creation | Existing retained terms readers |
| Artifact kind | Always any on new games | decideNewTerms |
| Rematch | previousGameId of settled same pair; reject stale or open chain | readRematch, assertLatestInChain under lockGamePair |
| Open-game cap | Ten shared open games; pending chat games count | assertPairCapacity under lockGamePair |
| Access | Listed creator for fresh games; unlisted may rematch an on-game | isGameOn / isGameEnabledFor |
| Content | Same task/prize/dare checks | moderateGameCommand before mutation |
| Profiles | Existing GameProfile name and timezone required for both | GameProfile is the only structured first-name owner in Web; shared displayName is not a first name and pendingActivationTimeZone is not current profile data. Missing profile returns PROFILE_REQUIRED directing that person to set name/timezone in the app; never split a display name or infer a zone. |
| Private invitee name/photo/relationship | Omitted from chat creation; use own GameProfile names | Private labels are viewer-owned, not group choices |
| Invite link | Not sent in chat; existing encrypted token retained for native accept | Existing GameView token visibility |

Native source inspected read-only at local origin/main `3055e626461110aa4e6f14df07a3c611ec423e40`; the supplied checkout HEAD predates Game. Setup serialization in LiveGameService maps every option above. Native maps negotiating plus seat 1/no pendingChange to Shake on it, and seat 0 to waiting/change/cancel. No app files changed.

## Decisions and architecture

- Extend update_game with create, not a new tool. Reuse createGame with trusted
  chat context to seat the pair atomically in negotiating, without pendingChange.
  Existing invited creation cannot meet the outcome because its second seat is
  unclaimed; existing negotiate requires an invitee counteroffer. No new persisted
  table, column, status, flag or queue is needed.
- Extend approve's argument shape to accept current terms without a proposalId,
  using expectedTermsVersion and the existing join/accept service. Other responses
  keep their existing proposal semantics. Counteroffers reuse propose/respond;
  declining the whole unstarted game reuses cancel_game.
- The runtime supplies accepted message identity only. The server resolves actor,
  verifies exact room membership before and inside mutation, and maps member-keyed
  task text to seats. No model-selected actor or destination.
- A shared game read can be empty before the first game. Permit this read
  after exact-pair authorization; only create can write without an existing game.
- Reuse pair-lock admission helpers for app rematches, chat creates and joins.
  Check same gameId again under the lock before capacity/chain checks; retries
  never auto-accept an opposite pending rematch from chat.
- Initial proposal is the ordinary reply, no lifecycle announcement. Existing
  started event reserves kickoff; cancellation retains its existing single notice.
- HTTP current-terms gate remains HTTP-only. Web accepts additive operations first;
  older runners never send them. No native wire shape change.
  Inspection of the model-facing groupSummaryModelResult disproved the initial
  transport-only finding: membership deliberately removes memberId and handle,
  and room memory forbids handles. Use a minimal marked read_game roster. The
  deployed strict state reader rejects extra players, so Web-first ordering alone
  cannot avoid old-reader failures. Remove includePlayers after old readers drain;
  the spec owns this cleanup.
- Native polls settle a debated shared choice, never a person's own task or consent.
  One poll, 2–4 concrete options, read results before use; ties need clarification.

## File scope

Final task files (the plan is archived under completed at commit):

- `ARCHITECTURE.md`
- `agent-docs/exec-plans/completed/2026-11-02-game-chat-setup.md`
- `agent-docs/index.md`
- `agent-docs/product-specs/weekly-game.md`
- `apps/web/changelog/entries/2026-11-02/game-chat-setup.json`
- `apps/web/src/lib/game/chat-membership.ts`
- `apps/web/src/lib/game/chat-tool.ts`
- `apps/web/src/lib/game/contract.ts`
- `apps/web/src/lib/game/service.ts`
- `apps/web/test/game-chat-membership.test.ts`
- `apps/web/test/game-chat-setup-postgres.test.ts`
- `apps/web/test/game-chat-tool.test.ts`
- `packages/assistant-engine/skills/group-challenge/SKILL.md`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools/games.ts`
- `packages/assistant-engine/test/assistant-codex-real-e2e.test.ts`
- `packages/assistant-engine/test/assistant-game-tools.test.ts`
- `packages/assistant-engine/test/assistant-managed-group-skill-fallbacks.test.ts`
- `packages/assistant-engine/test/assistant-usage-input-measurement.test.ts`
- `packages/assistant-engine/test/support/game-chat-setup-scenarios.ts`
- `packages/assistant-runtime/test/hosted-runtime-group-tool-linq-context.test.ts`
- `packages/hosted-execution/src/game-chat-notifications.ts`
- `packages/hosted-execution/src/game-tools.ts`
- `packages/hosted-execution/test/game-chat-notifications.test.ts`
- `packages/hosted-execution/test/game-tools-compatibility.test.ts`

## Verification and UX

### Addressed Play again and random IDs (owner addition)

Expose only unexpired, unblocked addressed rematches for this exact pair. Their
existing shared shape has status invited and one seated creator; the other
member in the read roster is the addressee. Prove that shape against the deployed
strict reader before adding any compatibility gate. Unaddressed bearer-link
invites remain app-only. Initial approval resolves the private token server-side
and calls join; explicitly refuse the creator's approval (decideJoin otherwise
treats an already-seated creator as an idempotent join).

Native LiveGameService.negotiateRematch uses the existing negotiate command,
not proposeChange. Map the chat propose operation for the unseated invitee to
that command, retaining its pair lock/admission and setting chat-origin delivery
so the reply is the only change announcement. The invitee has no cancellation
before claiming a seat; leave it open and explain that its creator can call it
off. No new state, tool, schema field or native contract is required.

Creation guidance and the gameId field will require game_ plus at least 20
random lowercase letters/digits, never names/dates/terms, with reuse only for
the same retry. Recorded eval arguments must satisfy that format and exclude
fixture names, dates and terms. Add three Play again evals (invitee yes, creator
yes, invitee counter); drop the overlapping different-tasks case, whose behavior
remains in full terms, reversed PostgreSQL input and other-speaker ownership.
Total: 50. Additional files: chat-membership discovery, rematch notice builder
and its owning tests. Write CODE READY FOR STACK 2 after these code changes.

1. Deterministic creation, exact authority, idempotency, consent, moderation,
   profiles, cap race at nine, chain/access and GameView parity.
2. 30–50 real gpt-6.1-sol local-subscription journeys built from production prompts
   and tool schemas. Inspect every reply; exact calls and forbidden writes. Tune
   production guidance until Ready, then run twice more without weakening proof.
3. Focused tests, touched package/Web typechecks, touched-file lint, complexity diff.
4. Complete first provider-input comparison using identical base/head fixtures;
   distinguish measured tool bytes from whole-input tokenizer evidence.
5. Review full diff for privacy, minimal architecture and selected UX paths, then
   scripts/finish-task. Parent owns mocked iMessage stack and downstream PR gates.

## Progress and evidence

- Clean requested branch confirmed; frozen dependency installation succeeded.
- Rebased onto origin/main `0edefc73dc` before final proof. Main’s selection
  guidance, shared-room wording, day-off refusal and memberId-keyed recap
  superlatives are retained. Pre-rebase evals are diagnostic history only.
- Full setup/poll instructions now accompany every successful ordinary read_game
  result, alongside main’s selection guidance, never recap reads. Only two short
  triggers remain in the initial catalog.
- chatCreationOther no longer treats callback presence as authority: the two chat
  context fields originate only in the authorized chat handler, directly or via
  its photo helper (which only posts). The handler still supplies transactional
  reauthorization. Existing response-path callback requirements are unchanged.
- CODE READY FOR STACK was written to the ignored status file after these code
  changes and before post-rebase evals; the parent owns that stack test.
- Backend inventory confirms negotiating with two seats and no pending change is
  accepted by the ordinary join command; tasks and stakes lock only at live.
- Frog inventory read. The requested live suite matches multiple journeys; retain the one-journey guard and run discovered exact names in an uncommitted loop. The temporary friction entry requesting guard relaxation was withdrawn.

- PostgreSQL proof uses only the isolated local `murph_test_game_chat_setup` lane,
  provisioned with `prisma db push`. The app's create/negotiate/decline path and
  chat creation produce equal GameViews for each viewer after normalizing only
  per-game IDs, stake keys, tokens and expiry instants, with private labels absent.
- Native inventory: `GameProtoSetup.swift`, `GameProtoSetupSteps.swift`,
  `GamePrototype.swift`, `LiveGameService.swift`, `GamePrototype+Server.swift`,
  `GameProtoHome.swift` at the read-only ref above. Same-task sync creates two
  equal tasks; the date sheet maps today to nil; Start now is a later agreed
  change. Role derives from `mine.seat`; `canShakeOnTerms` is negotiating,
  invitee, no pendingChange. No simulator proof was needed for an unchanged
  wire shape; no native file was edited.
- The generic group-challenge fallback initially prohibited this separate game
  capability. It now explicitly defers to available two-player game tools while
  preserving the refusal for unavailable managed larger-group challenges.
- Tuning used exact discovered names, never changed the runner guard, and exposed
  the membership projection's identity stripping. Equivalent-number/verb reply
  checks and negated success claims were corrected to test meaning; exact write
  counts and arguments remain enforced. Further guidance fixes cover action-form
  task/stake words, unchanged poll labels, one-line refusals and no retry after
  rejected creation. The returned guidance repeats the 60-day boundary, and the
  game seat mapping explicitly reserves initial approval to seat 1. Complete start wording, explicit “both” for a shared task, poll-vote refusal and creator-only agreement are also asserted. The final table has 50 scenarios, including addressed Play again; three-run evidence is recorded below.
- Static prompt hash tripwire is unchanged and passes; game descriptions live
  in the dynamic tool catalog. Complexity guard passes with no changed function
  above 20. Changelog is content-only under the archive's no-preview rule.


The owner’s first mocked-iMessage stack journey passed on the rebased code:
chat creation seated the correct players/tasks, both native views matched app
negotiation, the invitee saw Shake on it, and their chat agreement started play.
This is owner-reported end-to-end evidence, separate from the local synthetic
proof. CODE READY FOR STACK 2 was written before the new final eval loops.
The addressed-rematch scope now also has PostgreSQL proof for chat agreement,
creator refusal, app-equivalent counter, wrong pair, bearer link, expiry and
blocking. The deployed strict reader accepts its one-seated-player shape.
The two changed existing real journeys (rematch notice and bearer-link app
handoff) passed focused runs in addition to the 50-scenario suite.

### Final outcome

All 50 scenarios passed each of ready7, repeat9 and repeat10, with every reply
reviewed: 150/150 Ready, no flaky scenario in those three full runs. The same
production guidance ran throughout. All 69 recorded create IDs (23 per run,
including refused attempts) match game_ plus 20–59 lowercase letters/digits,
exclude fixture names/dates/terms, and are distinct across the three runs.
Example IDs from the full-terms case:

- `ready7`: `game_k8w2n5q9z1r4t7v3b6m0x2c8`
- `repeat9`: `game_k7q2m9xp4v8n3r6t1w5z0bch`
- `repeat10`: `game_q7mn9w2kd6x4tr8vc5bp1sz0`

Final review also proved that two unlisted players received the room-size
refusal even in an exact-pair room. A regression assertion failed on that
message before the fix. Read/create sender authorization now remains about
identity; the handler separately returns GAME_DISABLED after exact provider
membership, before profiles, state reads or writes. Existing mutations retain
their on-game authorization. The affected Web suite/typecheck/lint and complexity
checks were rerun. The marked response builder was extracted into its own small
function to keep the handler within the existing complexity limit. This did not
change production prompts or the eval contracts.

## Deterministic verification

All database commands use local `DATABASE_URL` ending in
`/murph_test_game_chat_setup` and `MURPH_TEST_POSTGRES_CONCURRENCY=1`, never the
primary development data. Preparation used the documented local test lane:
`pnpm --dir apps/web exec prisma db push` and Prisma generation.

| Command | Result |
| --- | --- |
| `pnpm --dir apps/web test:prepared test/game-chat-setup-postgres.test.ts test/game-chat-tool.test.ts test/game-negotiation-postgres.test.ts test/game-service-postgres.test.ts test/game-command.test.ts test/game-rules.test.ts test/game-chat-membership.test.ts test/game-recap.test.ts` | 265 passed |
| `pnpm --dir apps/web test:prepared test/game-chat-tool.test.ts` (final response-shape extraction) | 29 passed |
| `pnpm --dir packages/assistant-engine exec vitest run test/assistant-game-tools.test.ts test/assistant-managed-group-skill-fallbacks.test.ts test/model-behavior.test.ts` | 99 passed |
| `MURPH_VERIFY_GAME_SETUP_SKEW=1 pnpm --dir packages/hosted-execution exec vitest run test/game-tools-compatibility.test.ts test/game-chat-notifications.test.ts` | 37 passed; 1 existing optional incomplete-day compatibility test skipped; new setup skew test ran |
| `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-group-tool-linq-context.test.ts` | 39 passed |
| `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx` | 4 passed |
| Web, assistant-engine, assistant-runtime and hosted-execution `typecheck` | Passed |
| Touched TypeScript files through Web's pinned `oxlint` | No errors; existing warnings in the large live test file and recap compatibility destructuring |
| `pnpm complexity:diff` | Passed; no changed function above 20 |
| `bash scripts/check-agent-docs-drift.sh`; `git diff --check` | Passed |

The new PostgreSQL proof includes create, native-view parity, initial agreement
and one kickoff, both cancellation actors and one notice, counter/decline/approve,
cap races (chat/chat and chat/app at nine), concurrent retry, reversed task input,
allowlist/rematch/global switch, profile refusal/recovery and invalid content/terms.
The existing service suite retains app creation, admission, post, settlement,
rematch and Home coverage. No production delivery port was exercised.
The historical-reader test is opt-in because it loads the exact base Git object;
ordinary shallow CI retains unconditional current schema/parser coverage. Local
completion explicitly enabled the historical proof, following the existing skew
test's pattern rather than requiring deeper CI history.

## Boundary review

Read discovery remains bounded to ten open games plus five settled games for
one pair; the new roster reads at most two profiles. Chat creation adds bounded
profile/name reads and the existing crypto/moderation preparation before the
pair-locked database mutation. Initial agreement and an unseated counter resolve
the stored token before entering the existing join/negotiate path. No provider
call or new retry loop was added inside a database transaction. Signed sender
and pair authority are revalidated at mutation, alongside cap/chain rules.
The runtime cannot select an actor or bypass that authority with its memberIds.

Native contract changes needed: none. The tool transport adds create,
initial-version approval and a marked roster only. MemberId-keyed recap
superlatives keep main’s existing contract. The current-terms HTTP gate remains
unchanged and does not newly gate chat moves. Parent-owned local-stack follow-up,
PR review, CI and deployment are outside this local-commit task.

## Initial provider input

Same complete-request capture test, installed Codex and `gpt-6.1-sol`, scripted
loopback provider and identical individual/group fixtures. The original capture
compared `f3acfb07a9`; the post-rebase capture compares `0edefc73dc`. Main added
a game-only group fixture, included below. Command:
`MURPH_MEASURE_USAGE_INPUT=1 MURPH_USAGE_INPUT_BASE=0edefc73dc pnpm --dir
packages/assistant-engine exec vitest run test/assistant-usage-input-measurement.test.ts`
(4 passed). Both sides include always-available game tools in group fixtures.

| Runtime | Before: base → feature bytes | Before delta | After rebase: main → feature bytes | After delta |
| --- | ---: | ---: | ---: | ---: |
| Individual | 167575 → 167575 | 0 | 167575 → 167575 | 0 |
| Group (family tools) | 167554 → 173870 | +6316 (3.77%) | 168132 → 170128 | +1996 (1.19%) |
| Group (shared-read tools) | 158540 → 164856 | +6316 (3.98%) | 159118 → 161114 | +1996 (1.25%) |
| Group (game tools) | Not in original fixture set | — | 151812 → 153808 | +1996 (1.31%) |

Moving setup rules to the successful read result reduces added initial bytes by
4320 (68.4%). Registered tool bytes after the move: family 78365 → 79040;
shared read 53866 → 54541; game-only 52586 → 53261 (+675 each). Individual tools
remain 43065 bytes. Before the move, added registered tool bytes were 4358.
Exact base/head token counts, token delta and percentage are unavailable because
no exact GPT-6.1 Sol tokenizer is configured; no estimate substitutes for a
measurement. The complete capture includes native generated tool/code-mode
guidance, system/developer instructions, messages and request metadata; only
prompt_cache_key is excluded. Candidate request adapters/public workspace
packages and installed native model catalog are shared by both captures.
Setup instructions now cost bytes only after a successful game read. The skill
body is loaded on demand and is not in this initial request.

## Real-model run record

Model: `gpt-6.1-sol`; auth: local subscription; reasoning: low. All journeys
use production prompt builders and real dynamic contracts with synthetic ports.
Discovery used `MURPH_RUN_REAL_CODEX_E2E=1 pnpm --dir packages/assistant-engine
exec vitest list --config vitest.config.ts test/assistant-codex-real-e2e.test.ts
--tagsFilter real-codex-live --json`. The uncommitted loop invokes
`pnpm test:assistant:live -- --test "<anchored exact discovered title>"` once
per name, at most two concurrently after the first paired calls succeeded. The runner and its one-journey guard are unchanged.

Only the three full runs after rebase onto `0edefc73dc` count for completion.
Earlier attempts, including the user-stopped ready4 run, are diagnostic history.

Every scenario below has the prefix `game chat setup eval: `. P means passed
exact calls/arguments/counts, suppression, reply truth and tone review; F means
failed; — means not attempted. The final three runs use the same production
guidance. Counts below include only completed invocations; incomplete runs are
not Ready.

- ready7: 50/50 completed invocations passed; 50/50 completed.
- repeat9: 50/50 completed invocations passed; 50/50 completed.
- repeat10: 50/50 completed invocations passed; 50/50 completed.

| Scenario | ready7 | repeat9 | repeat10 |
| --- | --- | --- | --- |
| full terms in one message | P | P | P |
| default seven days every day | P | P | P |
| dare for loser | P | P | P |
| 3 day length | P | P | P |
| 30 day length | P | P | P |
| 365 day length | P | P | P |
| weekdays schedule | P | P | P |
| named days schedule | P | P | P |
| any three days total | P | P | P |
| tomorrow start | P | P | P |
| named date start | P | P | P |
| today uses acceptance default | P | P | P |
| same task for both | P | P | P |
| other speaker states own task | P | P | P |
| incremental final missing choice | P | P | P |
| one task still unknown | P | P | P |
| only missing prize | P | P | P |
| out of range length | P | P | P |
| start beyond sixty days | P | P | P |
| other player agrees | P | P | P |
| poll vote is not agreement | P | P | P |
| creator cannot agree for other player | P | P | P |
| Play again invitee accepts in chat | P | P | P |
| Play again creator cannot accept | P | P | P |
| Play again invitee suggests changes | P | P | P |
| other player declines whole game | P | P | P |
| requester cancels before agreement | P | P | P |
| start now uses existing change | P | P | P |
| other player counters | P | P | P |
| requester changes duration | P | P | P |
| poll debated task | P | P | P |
| poll debated prize | P | P | P |
| poll debated length | P | P | P |
| poll debated start | P | P | P |
| poll debated schedule | P | P | P |
| poll winner read then proposed | P | P | P |
| tied poll asks for choice | P | P | P |
| own task choice never polled | P | P | P |
| simple yes no never polled | P | P | P |
| third person makes room ineligible | P | P | P |
| missing other player profile | P | P | P |
| pair cap refusal | P | P | P |
| access disabled refusal | P | P | P |
| content refusal | P | P | P |
| settled game rematch | P | P | P |
| refused rematch | P | P | P |
| new game leaves live game alone | P | P | P |
| new versus change ambiguity | P | P | P |
| sometime is not a request | P | P | P |
| duplicate request no second game | P | P | P |

### Earlier diagnostic attempts

These are diagnostic attempts, not completion passes. `tuning1` failed name
selection before provider execution; `tuning2` exposed conflicting fallback
guidance; `tuning3` exposed the model projection stripping player references.
Later failures led to base-verb task/stake guidance, verbatim poll labels, no
extra reads after rejection, explicit shared-task/start wording, the 60-day
field constraint and seat-based consent. Equivalent-word reply checks were
corrected without relaxing action counts or arguments. The date and creator
consent cases also passed focused reruns before the final suite. A repeat
then exposed an agreement wording flake (correct approval, “game is live”);
the owning instruction now asks for “has started”, with assertions unchanged.

After rebase, final1 exposed daily-schedule wording; guidance now says every day. A two-live-game ambiguity focus led to clarifying intent before gathering terms. In ready6, content refusal used a negated creation recap (could not be created); the existing assertion rejected it. Guidance now states the content rule directly. Assertions were not weakened; all seven remaining focused cases passed before restarting the three full runs. User-stopped loops are interruptions, not code failures.

- tuning1: 0/1 passed.
- tuning2: 0/15 passed.
- tuning3: 0/3 passed.
- tuning4: 37/45 passed.
- run1: 6/7 passed.
- ready1: 12/13 passed.
- ready2: 19/20 passed.
- tuning6: 27/28 passed.
- ready3: 48/48 passed.
- repeat1: 20/21 passed.
- ready4: 5/5 passed.
- final1: 3/4 passed.
- ready6: 43/44 passed.

| Scenario | tuning1 | tuning2 | tuning3 | tuning4 | run1 | ready1 | ready2 | tuning6 | ready3 | repeat1 | ready4 | final1 | ready6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full terms in one message | F | F | F | F | P | P | P | — | P | P | P | P | P |
| default seven days every day | — | F | F | F | F | P | P | — | P | P | P | P | P |
| dare for loser | — | F | F | F | P | P | P | — | P | P | P | F | P |
| 3 day length | — | F | — | P | P | P | P | — | P | P | P | P | P |
| 30 day length | — | F | — | P | P | P | P | — | P | P | P | — | P |
| 365 day length | — | F | — | P | P | P | P | — | P | P | — | — | P |
| weekdays schedule | — | F | — | P | P | P | P | — | P | P | — | — | P |
| named days schedule | — | F | — | P | — | P | P | — | P | P | — | — | P |
| any three days total | — | F | — | P | — | P | P | — | P | P | — | — | P |
| tomorrow start | — | F | — | P | — | P | P | — | P | P | — | — | P |
| named date start | — | F | — | P | — | P | P | — | P | P | — | — | P |
| today uses acceptance default | — | F | — | P | — | P | P | — | P | P | — | — | P |
| same task for both | — | F | — | P | — | F | P | — | P | P | — | — | P |
| other speaker states own task | — | F | — | P | — | — | P | — | P | P | — | — | P |
| incremental final missing choice | — | — | — | P | — | — | P | — | P | P | — | — | P |
| one task still unknown | — | — | — | P | — | — | P | — | P | P | — | — | P |
| only missing prize | — | — | — | P | — | — | P | — | P | P | — | — | P |
| out of range length | — | — | — | P | — | — | P | — | P | P | — | — | P |
| start beyond sixty days | — | — | — | P | — | — | F | — | P | P | — | — | P |
| other player agrees | — | — | — | P | — | — | — | P | P | F | — | — | P |
| poll vote is not agreement | — | — | — | — | — | — | — | P | P | — | — | — | P |
| creator cannot agree for other player | — | — | — | — | — | — | — | F | P | — | — | — | P |
| Play again invitee accepts in chat | — | — | — | — | — | — | — | — | — | — | — | — | P |
| Play again creator cannot accept | — | — | — | — | — | — | — | — | — | — | — | — | P |
| Play again invitee suggests changes | — | — | — | — | — | — | — | — | — | — | — | — | P |
| other player declines whole game | — | — | — | P | — | — | — | P | P | — | — | — | P |
| requester cancels before agreement | — | — | — | P | — | — | — | P | P | — | — | — | P |
| start now uses existing change | — | — | — | — | — | — | — | P | P | — | — | — | P |
| other player counters | — | — | — | P | — | — | — | P | P | — | — | — | P |
| requester changes duration | — | — | — | P | — | — | — | P | P | — | — | — | P |
| poll debated task | — | — | — | P | — | — | — | P | P | — | — | — | P |
| poll debated prize | — | — | — | P | — | — | — | P | P | — | — | — | P |
| poll debated length | — | — | — | P | — | — | — | P | P | — | — | — | P |
| poll debated start | — | — | — | F | — | — | — | P | P | — | — | — | P |
| poll debated schedule | — | — | — | P | — | — | — | P | P | — | — | — | P |
| poll winner read then proposed | — | — | — | P | — | — | — | P | P | — | — | — | P |
| tied poll asks for choice | — | — | — | P | — | — | — | P | P | — | — | — | P |
| own task choice never polled | — | — | — | P | — | — | — | P | P | — | — | — | P |
| simple yes no never polled | — | — | — | P | — | — | — | P | P | — | — | — | P |
| third person makes room ineligible | — | — | — | P | — | — | — | P | P | — | — | — | P |
| missing other player profile | — | — | — | P | — | — | — | P | P | — | — | — | P |
| pair cap refusal | — | — | — | P | — | — | — | P | P | — | — | — | P |
| access disabled refusal | — | — | — | P | — | — | — | P | P | — | — | — | P |
| content refusal | — | — | — | F | — | — | — | P | P | — | — | — | F |
| settled game rematch | — | — | — | P | — | — | — | P | P | — | — | — | — |
| refused rematch | — | — | — | F | — | — | — | P | P | — | — | — | — |
| new game leaves live game alone | — | — | — | P | — | — | — | P | P | — | — | — | — |
| new versus change ambiguity | — | — | — | P | — | — | — | P | P | — | — | — | — |
| sometime is not a request | — | — | — | P | — | — | — | P | P | — | — | — | — |
| duplicate request no second game | — | — | — | F | — | — | — | P | P | — | — | — | — |
Completed: 2026-11-02
