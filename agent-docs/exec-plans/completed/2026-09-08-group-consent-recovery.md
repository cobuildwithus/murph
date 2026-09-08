# Make existing group permission recovery work on the first request

Status: completed
Created: 2026-09-08
Updated: 2026-09-08

## Goal and protected boundary

An existing group member requests one additional health permission, receives one
clear consent surface in the same chat, reacts once, and receives confirmation.
Only the exact immutable scope displayed on the reacted-to message is granted.
Existing memberships, grants, and unrelated consent messages remain usable.

## Product UX

- Effort: Product change.
- Entry: an existing group with multiple grants, sleep timing granted, sleep
  duration absent, and a different active offer. All evidence uses synthetic data.
- Journeys: direct request; accepted offer to repost; existing matching offer;
  provider failure and exact retry; older unrelated offer; repeated reaction;
  missing data after grant; private-chat recovery advice; new member joins.
- Done when: no preliminary permission-to-offer question, no private-chat detour,
  exact scope and one surface, explicit saved-permission confirmation, and no
  invented claim that permission proves data availability.

## Owners and decisions

Web owns group policy, immutable message-bound offers, grants, and notification
mailboxes. Assistant Engine owns resident capability guidance and tool semantics.
Native offers extend requested settings without replacing unrelated offer scopes;
legacy explicit join-link policy replacement keeps its existing boundary.
Use the existing notification/outbox path for confirmation, not a new queue.
Keep the reaction itself context-only. Do not turn generic reactions into replies.
No schema or dependency change, production mutation, or member-facing delivery is required.

## Tasks

1. Reproduce the scoped repost failure and isolated-test setup failure.
2. Correct offer preparation/binding and preserve older consent surfaces.
3. Improve resident tool instructions, consent copy, and saved-grant confirmation.
4. Prove synthetic composed store/reaction/delivery boundaries and real Codex
   direct-request, repost, explanation, and recovery journeys.
5. Update owner docs and changelog; run focused tests, typechecks, complexity,
   privacy and candidate review; complete the scoped commit and applicable review.

## Risks and mitigations

- Scope changes cannot reinterpret existing messages: bind exact snapshots and
  retain generation/replay checks, including changed concurrent policy.
- Notifications must be atomic with grant acceptance and provider event handling;
  retries reuse existing mailbox/outbox identities.
- Posting a prompt is not consent; a grant is not data. Keep both distinctions
  explicit in tool results and member-visible language.
- All new protocol behavior uses existing wire shapes. Verify old/new consumers
  and document the Web-first release boundary.

## Verification

- Web tool, store, reaction, notification-destination, and mailbox-root tests pass.
  The focused repost case also passes independently after fixing its mock setup.
- A loopback PostgreSQL composition seeds two members, existing timing and other
  grants, and an unrelated offer. Actual offer preparation/binding and reaction
  acceptance preserve old grants, grant only the newly selected duration scope,
  retain unrelated offers, and queue exactly one encrypted group confirmation.
  Replaying the reaction does not queue another confirmation.
- Assistant Engine group tool/parser, resident prompt, and exact-text notification
  tests pass. The existing notification consumer exercises actual send policy,
  authority checks, cancellation recovery, and model bypass.
- Hosted Execution: 634 tests pass.
- Web, Assistant Engine, and Hosted Execution typechecks pass. Scoped Web lint has
  zero errors and one pre-existing unused-binding warning in disclosure posting.
- Complexity guard passes with no increase in debt. The existing large dispatch,
  acceptance, and prompt-building functions retain their ownership; extracting
  unrelated behavior would enlarge this fix. The obsolete scope comparison in
  the Web tool was removed, and the existing route projection was reused.
- Changelog fragment renders through the production archive test.

Focused live commands use `pnpm test:assistant:live -- --test <pattern>` with
`gpt-5.6-terra` and local subscription auth. Each pattern selects one journey:

- `group permission recovery handles direct`
- `group permission recovery handles repost`
- `group permission recovery handles unavailable`
- `group permission recovery handles explain`
- `group permission recovery handles already_granted`
- `group permission recovery handles private`
- `binds a requested native access repost to the current group message`

The direct and private journeys both pass using the installed managed hosted
skill. All seven focused journeys have a Ready reply-review verdict. Private
recovery initially failed the UX bar; its guidance is now scoped to private
conversation separately from native group posting, and the final replay gives
the supported next step without claiming a mutation or temporary failure.
Early subscription profiles failed before any provider action; an existing
working profile was selected under the verification owner's fallback rule.
No auth material was read or copied. An outdated shared local test schema was
avoided by provisioning an isolated loopback database from the current schema.

## Product review

Result: Ready for local review. Parent candidate review and added-content privacy
scan passed. No source or test fixture contains private production evidence.

The group request/repost journeys produce one exact-scope surface with no
companion message or preliminary confirmation. Existing timing permission is
acknowledged accurately. Send failure gives a concise retry in the same group.
An already-granted permission triggers one shared-data check, never another
consent prompt or an invented value. Private recovery uses membership inventory
and gives an actionable supported destination without a handoff or grant claim.
First joins retain private confirmation; legacy routes lacking a sender-account
binding retain consent acceptance without an unrouteable group confirmation.

## Release boundary

This is a locally verified patch. No production data, messaging, deployment,
branch push, or PR has been performed. PR CI and the risk-routed ReviewGPT gate
remain release work, as does complete base/head provider-input measurement.
The changelog source-PR array is intentionally empty until a PR exists.

Deploy Web support before the runtime instruction update. Existing wire and
mailbox shapes work with old consumers, and consent messages retain immutable
scope snapshots. An old Web may still reject a new scoped repost, so mixed
versions do not guarantee the improved UX. Reverting Web restores that limitation
without broadening any persisted grant. No migration or backfill is needed.
Completed: 2026-09-08
