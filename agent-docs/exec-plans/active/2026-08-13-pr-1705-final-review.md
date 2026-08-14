# PR #1705 final review

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Refactor the exact-message current-sender group-chat change so one personal
  read target is independent from its fixed result destination, then finish the
  required final review, exact-head CI, and merge boundary.

## Success criteria

- Clarification replacement remains causally monotonic and resolved pointers cannot reopen on replay.
- Group notice targeting resolves an earlier exact accepted message after later live input arrives.
- New mailbox requests write one `current_sender_personal` target and persist
  `origin_context` or same-channel `requester_direct` separately.
- One source-derived request identity admits at most one result destination;
  replay attempting to switch it conflicts without another personal read.
- Already-admitted `group_sender` and `group_sender_private` shapes retain their
  stored meaning during the bounded deployment drain.
- A later continuation cannot reach its notice or Web transition before an
  earlier clarification settles, while independent new exact-ref requests
  remain concurrent.
- For contradictory same-ref calls, the first strictly parsed accepted App
  Server request claims the decision in arrival order before lane selection or
  the pre-tool hook.
- A committed group fallback supersedes private delivery across lost authority
  responses and route recovery; expired detached replay does not create a
  competing group terminal beside an existing private effect.
- A valid answered group completion converges to the fixed non-disclosing
  fallback if the sender loses personal runtime access before provider entry.
- Durable owner docs describe natural audience inference and clarification instead of retired phrase classification.
- Focused Web, assistant-runtime, PostgreSQL, type, documentation, and privacy checks pass.
- The final ReviewGPT gate passes, required exact-head CI is green, and the PR reaches the repository-authorized merge boundary.

## Scope

- In scope: the unified current-sender target, separately pinned result
  destination, drain-only legacy readers, clarification terminology, accepted
  final-review findings, focused regression coverage, durable contract
  alignment, review/CI evidence, and PR packaging.
- Out of scope: personal-to-group content sharing, workout-specific behavior,
  unrelated messaging changes, a new delivery service, or broad provider
  transport redesign.

## Constraints

- Keep exact source identity and Web-owned sender/route authority.
- Preserve natural model intent inference and conversational clarification.
- Keep physical group completion and same-channel exact private notification as
  separate effects; only read-target identity is unified.
- Treat current-sender clarification and continuation calls as stateful
  transitions ordered by the existing app-server dynamic-tool chain; provider
  scheduling must not let a later continuation overtake an earlier
  clarification, while independent new exact-ref requests remain concurrent.
- Claim contradictory same-ref decisions at accepted App Server request intake,
  before choosing the serialized or immediate execution lane.
- Add no context registry, shared memory, queue, service, or workflow owner.
- Do not add state or retry machinery that cannot provide a real provider-level guarantee.
- Preserve the already-consumed base-update budget unless the user grants new authority.

## Tasks

1. Refactor the protocol, Web authority, runtime consumer, clarification field,
   tests, and owner docs around one target plus separate result destination.
2. Verify and commit the replacement candidate, preserving the bounded legacy
   drain and exact source/replay/route properties.
3. Run the next sensitive full-snapshot ReviewGPT round and resolve qualifying findings.
4. Require exact-head CI, prove the current-base merge result, and complete the authorized PR path.

## Verification

- Focused current-sender Web and PostgreSQL tests.
- Focused assistant local-runtime tests and package typechecks.
- Documentation drift and privacy checks.
- ReviewGPT full-snapshot PASS and required GitHub checks on the exact head.

Local replacement-candidate evidence on 2026-08-13:

- Hosted-execution current-sender contract: 8 tests passed; package typecheck passed.
- Assistant-runtime current-sender and detached execution: 22 tests passed;
  workspace entrypoint: 302 tests passed; package typecheck passed.
- Web authority and owner-doc contract: 24 tests passed; real PostgreSQL
  lifecycle: 7 tests passed; prepared Web typecheck and focused Web lint passed.
- Changelog fragment validation: 7 tests passed; agent-doc drift, diff hygiene,
  and identifier privacy scan passed.
- ReviewGPT round 14 completed late after its initially interrupted wait. Its
  causal-transition finding was reproduced at the app-server/Web boundary: two
  requests reached Web while the earlier clarification was held open. The
  existing stateful dynamic-tool chain now orders only clarification and
  continuation; focused proof shows the later continuation and notice wait,
  while an independent exact-ref request still starts concurrently. The focused
  runtime test, seven current-sender engine tests, Assistant Engine typecheck,
  owner-doc contract, and docs drift pass.
- The first untrusted attempted ReviewGPT round 15 found that a committed
  route-loss fallback did not fence a later private provider-entry retry after
  route recovery, while expired
  detached control could append a group terminal beside a committed private
  effect. Both paths failed in focused reproduction. Provider-entry authority
  now recognizes and re-hands the existing fallback before route resolution;
  expired control re-hands the deterministic private item and leaves fallback
  conversion to that item's existing provider-entry owner. The focused Web
  suite passes 24 tests, real PostgreSQL proof passes 9 tests, and prepared Web
  typecheck passes. Round 15 returned findings but reported unknown model
  confirmation, so it is remediation evidence rather than the required trusted
  final PASS.
- The replacement substantive round 15 found that Web accepted an
  unmarked old `ask_current_sender` group request even though that old runtime
  could not send the now-required advance room notice. A focused route test
  reproduced the bypass as HTTP 200 instead of the required fail-closed 400.
  Web now rejects that unmarked group admission before tool or mailbox work,
  while unmarked private compatibility and persisted legacy drains remain.
  This deletes the unsafe compatibility upgrade and adds no state or owner.
  The focused Web suite passes 45 tests, the current-sender Assistant Engine
  suite passes 7 tests, the Cloudflare marker/replay suite passes 19 tests,
  prepared Web typecheck and focused Web lint pass, and docs drift passes. The
  exact-head full snapshot ran well beyond the 7.5-minute trust floor, completed
  with substantive path analysis and the required marker, and its independent
  capture metadata verifies `gpt-5-6-pro`; the response's inability to
  self-report its model does not override that external evidence. It therefore
  counts as substantive round 15.
- ReviewGPT round 16 found that concurrent same-ref tool calls could choose
  private, group, or clarification before Web's durable request conflict. Web
  still prevented a second personal read, but private-first execution could
  emit a false room notice, duplicate group calls could emit two notices, and
  clarification could coexist with admitted work. Four focused tests reproduced
  those races. The existing per-turn group-tool state now claims the first
  decision synchronously before any external await, rejects a contradictory
  same-ref decision before notice or Web work, and shares one in-flight notice
  across exact group repeats. Notice failure retains the group claim for the
  invocation; different exact refs remain concurrent. This adds no database
  state, queue, service, or lifecycle owner. Eleven focused engine tests, the
  production app-server concurrency proof, the 13-test current-sender filter,
  and Assistant Engine typecheck pass.
- ReviewGPT round 17 found two defects. First, round 16's decision map still
  claimed inside the executor, below the split between serialized
  clarification/continuation and immediate new requests, so a later new call
  could claim before the earlier accepted request reached its pre-tool hook.
  Second, a valid answered group completion became permanently stranded when
  the current sender lost personal runtime access after completion persistence
  but before provider entry. Both findings were accepted; none were rejected.
  Production App Server tests reproduced both decision directions, and Web unit
  plus real PostgreSQL proof reproduced the access-loss terminal. The claim now
  occurs in accepted App Server request arrival order immediately after strict
  parsing and before lane selection or the pre-tool hook; the executor consumes
  but never creates it. Provider entry now returns the existing fixed-fallback
  signal only for a structurally valid group-bound answered completion whose
  personal access was lost. Invalid envelopes and private destinations retain
  their fail-closed behavior. The current-sender Engine filter passes 15 tests,
  the Web authority file passes 25 tests, and the fully migrated PostgreSQL
  lifecycle suite passes 9 tests.
- ReviewGPT round 18 ran as a fresh sensitive full snapshot against the
  remediated exact head and returned `Findings: None`, `ROUND_OUTCOME: PASS`,
  and `REVIEW_COMPLETE`. Nothing was accepted or rejected, and no remediation
  or complexity was added. Independent capture metadata verified the requested
  `gpt-5.6-sol` run returned the `gpt-5-6-pro` response model.
- Required GitHub Actions remain pending because the current base conflict
  prevents GitHub from creating the pull-request merge ref that triggers those
  workflows. The permitted base-update budget remains consumed, so resolving
  that conflict requires explicit new user authorization.
- The manually dispatched private `Public Murph Integration` run against
  `dad0a41ed486` passed every feature E2E scenario and the current-sender
  PostgreSQL proof, then exposed a pre-existing missing authority-signing method
  in `hosted-onboarding-member-lock-postgres.test.ts` and failed its aggregate
  check. That file and its production crypto owner were outside this PR's diff,
  and the test file was byte-identical on current `main`. Its env mock now uses
  an ephemeral P-256 test signer and matching verification keyring. The exact
  failed file passes 24 tests against a fresh fully migrated PostgreSQL database;
  prepared Web typecheck and focused ESLint pass. This isolated regression-test
  correction adds no production behavior or runtime complexity and does not
  require another ReviewGPT round. The private workflow still needs an exact
  final-head rerun.

## Round-17 requirement retrospective

Rounds 14, 16, and 17 repeatedly exposed the same mechanism: provider request
acceptance, execution-lane scheduling, and first-decision ownership were split.
Ordering only stateful transitions fixed continuation causality but left
immediate new requests outside the arbitration point; moving the round-16 map
into the executor still let lane scheduling choose the winner.

The requirement-level decision is that accepted App Server server-request
arrival order owns the first decision for one exact ref. The existing request
handler now claims that decision after strict validation and before lane
selection, notice, the pre-tool hook, or Web. The downstream executor only
consumes the claim. This collapses authority into the existing dispatch owner
without a queue, persisted claim, workflow, service, retry protocol, or new
lifecycle state, and different exact refs remain concurrent.

The terminal decision is that a valid group-bound answered completion remains
an authorized group terminal even if the personal runtime loses access after
the read and persisted completion. Provider entry must replace its answer with
the existing fixed non-disclosing fallback rather than permanently silencing
the group. This reuses the outbox fallback signal and adds no second terminal
identity or recovery owner.
