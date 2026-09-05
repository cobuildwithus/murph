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
- [ ] Prove behavior with focused tests, typechecks, and real Codex journey.
- [ ] Review complexity and copy; add durable documentation and changelog.
- [ ] Scoped commit, PR, required review and CI.

## Verification so far

- Shared policy tests: 11 passed; existing device-syncd suite also passed (1,320 tests).
- Five focused Web suites: 204 passed; affected runtime/preference reruns passed.
- Device tool tests: 25 passed; hosted domain tool tests: 25 passed.
- Device-syncd, Assistant Engine, and Web typechecks passed. Fixed the already
  touched runtime authority test to use the declared public store export.
- Complexity guard passes; candidate selection debt fell by four and the
  dispatch predicate became simpler. Existing unrelated hotspots are unchanged.
- Live WHOOP preference proof is pending local subscription startup recovery.
- No production messages, provider calls, or state mutations performed.
