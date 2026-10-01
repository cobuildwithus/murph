# WHOOP recovery check-ins

## Outcome and architecture

Extend the existing source recovery notice policy to Junction WHOOP (`whoop_v2`).
Reuse the five-day no-data threshold, member preference, canonical source row,
mailbox episode identity, and final Linq dispatch revalidation. No new table,
scheduler, retry owner, or provider request. WHOOP stays pull-capable.

The current eligibility predicate excludes WHOOP and all errored sources.
Admit connected WHOOP sources and the explicit `TOKEN_REFRESH_FAILED` state
after an established source has stopped delivering for five days. Ordinary
missing data never proves disconnection. Keep copy neutral and offer help.
Never-delivered, disconnected, unavailable, and unrelated error states remain
outside this established-source check. Reuse canonical lifecycle plus last
delivery for dedupe; receipt resumption ends the episode.

## Product UX plan — Product change

- Outcome: a member can learn that WHOOP data stopped reaching Murph and get help.
- Entry/promise: existing background sync evaluates the source; eligible active
  members with recent inbound receive at most one check per gap in their current
  direct Linq conversation. Default wait is five days; existing chat controls
  extend it to 5–30 days, restore default, or disable checks.
- People: a previously syncing member with a stale connected source; a member
  with a confirmed refresh failure; someone whose source resumes before send;
  someone who disables/defer checks; someone without an eligible direct thread.
- Recovery: avoid invented causes, automatic recovery claims, or unsolicited
  reconnect links. A reply can use existing device help. Check-ins do not alter
  connection or sync state. Quiet and ineligible paths remain silent.
- Proof: focused policy, runtime-apply, mailbox, dispatch, preference and real
  Codex opt-out journeys; review exact member-facing text.

## Load and deployment

Candidate selection uses the existing bounded runtime source batch. Notices are
materialized sequentially, one short database-only transaction at a time, with
the existing prepared mailbox crypto and post-commit signal. Only a selected
error-code column is added; no new queries or fanout. Existing egress owns its
one-source lock and final eligibility check. No wire or schema change; old Web
rejects WHOOP notices it cannot validate. Web owns admission and dispatch.

## Work

- [x] Extend shared policy and carry canonical error code through notice checks.
- [x] Add neutral WHOOP copy and expose existing conversation preference control.
- [x] Prove behavior with focused tests, typechecks, and real Codex journey.
- [x] Review complexity and copy; add durable documentation and changelog.
- [ ] Scoped commit, PR, required review and CI.

## Verification so far

- Shared policy tests: 11 passed; existing device-syncd suite also passed (1,320 tests).
- Five focused Web suites: 204 passed; affected runtime/preference reruns passed.
- Device tool tests: 25 passed; hosted domain tool tests: 25 passed.
- Device-syncd, Assistant Engine, and Web typechecks passed. Fixed the already
  touched runtime authority test to use the declared public store export.
- Complexity guard passes; candidate selection debt fell by four and the
  dispatch predicate became simpler. Existing unrelated hotspots are unchanged.
- Live WHOOP preference proof passed on gpt-5.6-terra with local subscription
  auth. Exactly one WHOOP opt-out write; no connection or sync change. Parent
  reviewed the actual concise, truthful reply: Ready.
- No production messages, provider calls, or state mutations performed.

## Provider input proof

Captured complete first Responses request content from the production prompt
builder and tool catalogue through the real Codex binary into a loopback-only
synthetic provider. No upstream request or authentication material was used.
Same direct/group fixtures at base and head; normalized generated UUIDs and the
shared temporary fixture root. Counted serialized `input`, `tool_choice`, and
`text` (the request has no separate `instructions` or `tools`; code-mode guidance
is in `input`), excluding non-content transport metadata and generation settings.
Tokenizer: installed gpt-tokenizer 3.4.0, o200k_base for gpt-5.6-terra.

- Individual: 26,029 to 26,039 tokens (+10; +0.0384%); 120,162 to 120,196 bytes (+34).
- Group: 22,029 tokens and 102,024 bytes at both revisions (device tool absent).
- Scope is representative fixtures, not every production member context.
- Changelog archive test: 9 passed; content-only production study is the existing
  changelog archive. No renderer or UI component changed.

## Candidate handoff

Resumed from the original session with the explicit task handoff. Local and
remote PR head both matched the original implementation commit; the remaining
plan and changelog edits matched the original session. Draft PR: #2850.

Parent walkthrough: stale connected sources and confirmed refresh failures
use one five-day silence episode; resumed delivery, disconnect, opt-out, and
ineligible conversations suppress the notice. The focused synthetic final
dispatch tests prove the existing egress boundary. Real-Codex WHOOP opt-out
proof confirms one preference write and one accurate acknowledgement. Ready.

Implementation and local evidence are complete. Required ReviewGPT and exact
head CI remain PR completion gates; this archived plan is not deployment proof.
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
