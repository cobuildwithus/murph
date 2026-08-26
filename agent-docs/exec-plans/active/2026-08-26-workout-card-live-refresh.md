# Workout card live refresh

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Progress

- Root cause proved from bounded production evidence: the accepted member
  action waited behind idle-checkpoint preparation, then canonical application
  completed promptly once imported. The transcript card remained its original
  embedded snapshot by design.
- Tasks 1-5 are implemented in the backend and companion worktrees. Schema-7
  emission remains platform-gated until the compatible companion reader lands.
- Focused backend suites and every affected package typecheck pass. The full
  contracts and vault-usecases suites pass, along with the focused Web member
  action routes.
- Companion formatting, source parsing, API/workout-core typechecks, and
  project generation pass. Simulator and physical Messages proof remain blocked
  because the current host has no Xcode or iOS SDK.
- Remaining: create coordinated draft PRs, run exact-head CI and ReviewGPT,
  resolve accepted findings, record the native verification gap, and archive
  this plan with the final backend commit.

## Goal

- Make a workout-card save reach the canonical workout without waiting behind
  an idle snapshot, then let the expanded Messages reader replace an old
  embedded workout snapshot with the latest canonical state.

## Success criteria

- A `member.action.requested` wake that arrives while a dirty runtime is waiting
  to checkpoint runs before the idle snapshot when no conversation work is
  waiting.
- The immutable transcript bubble remains readable and unchanged, while an
  expanded schema-7 workout reader attempts one authenticated refresh and
  renders the returned canonical projection.
- Refresh resolution uses a stable opaque workout binding only within the
  member authorized by the Messages-scoped bearer. The binding is neither
  identity nor write authority and a forwarded or stale unmatched card fails
  closed.
- Network, credential, unsupported-reader, completed-workout, and projection
  failures retain the complete embedded snapshot without erasing a local
  draft or claiming freshness.
- The native reader lands before schema-7 emission. Web and runner support land
  before the producer is enabled, with the prior V4/V6 fallback retained until
  the compatible rollout is complete.

## Scope

- In scope: pre-checkpoint safe-wake classification, a stable refresh binding,
  the closed workout-snapshot member request and typed result, schema-7 workout
  encoding/decoding, the Messages refresh lifecycle, focused tests, governing
  docs, and coordinated backend/native rollout proof.
- Out of scope: mutating an existing Messages transcript bubble, a card-state
  database, canonical workout storage changes, a general vault read API,
  background refresh, analytics, or refresh support for non-workout cards.

## Constraints

- Technical constraints: canonical `activity_session` state remains the only
  mutable workout owner; Web still has no vault read authority; the refresh
  request uses the existing encrypted system mailbox and terminal-outcome
  boundary; the selected card URL contains no member id, canonical workout id,
  credential, or write capability; all payloads remain strict and bounded.
- Product/process constraints: treat this as a product change. The entry point
  is opening an existing active workout card. The visible promise is latest
  available workout data with truthful offline fallback. Coordinated native and
  backend PRs require exact counterpart heads, compatible deployment order,
  focused verification, ReviewGPT, and a physical Messages evidence gap if a
  real device cannot be exercised.

## Risks and mitigations

1. Risk: a stable opaque binding correlates multiple snapshots of one workout.
   Mitigation: derive it from the high-entropy canonical workout id with a
   domain-separated one-way hash, expose no raw id, require the member-scoped
   bearer, and scan only that member's bounded canonical workout collection.
2. Risk: a refresh races a local unsaved draft and silently discards edits.
   Mitigation: refresh before creating the selected-message editor session and
   never replace a session that has a dirty or admitted request.
3. Risk: a wake notification is consumed before a long snapshot and leaves the
   accepted request queued.
   Mitigation: admit the complete safe `member.action.requested` prefix through
   the foreground-causal pre-checkpoint path and pin ordering with an entrypoint
   regression.
4. Risk: schema-7 or enriched outcomes establish a rollback floor.
   Mitigation: ship the native reader first, then compatible Web/runner readers,
   then enable producer emission; keep V4/V6 and embedded-snapshot fallback.
5. Risk: an original card lacks enough trusted plan information to reconstruct
   changed structure.
   Mitigation: preserve exact target labels only for matching coordinates;
   otherwise return no fresh projection instead of inventing or shifting a
   target.

## Tasks

1. Add the member-action wake to the existing pre-checkpoint-safe classifier
   and prove it runs ahead of an idle snapshot without outranking conversation.
2. Add a stable workout-refresh binding and schema-7 server envelope while
   preserving V4/V6 historical readers and the static V4 image path.
3. Add one closed workout snapshot request/result through the Messages-scoped
   member mailbox and canonical runtime reader.
4. Update the companion reader to request one latest snapshot on expanded open,
   preserve embedded state on failure, and protect dirty/admitted drafts.
5. Update authority, reliability, product, architecture, and rollout docs in
   both repositories.
6. Run focused tests, package typechecks, Swift formatting/build/tests, privacy
   and diff inspection, then finish the plan and commit coordinated PR heads.
7. Run the required ReviewGPT loops on both exact pushed heads and resolve every
   accepted finding.

## Decisions

- An existing transcript bubble remains immutable; freshness belongs only to
  the expanded reader.
- Reuse the existing scoped credential and mailbox instead of adding Web vault
  access, a card store, or a second queue.
- A refresh failure is silent in transcript presentation and explicit but
  non-destructive in expanded presentation; the embedded snapshot remains
  usable.

## Verification

- Commands to run: focused contracts, operator-config, vault-usecases,
  assistant-runtime, Web route, and companion API/decoder/controller tests;
  affected TypeScript package typechecks; `swiftformat --lint .`; `xcodegen
  generate`; simulator `xcodebuild test`; documentation drift and privacy/diff
  checks; exact-head ReviewGPT and CI.
- Expected outcomes: safe wake precedes idle snapshot, latest snapshot resolves
  only for one authorized workout, native refresh replaces only a clean selected
  session, every failure retains the embedded card, and both repository heads
  pass their required gates.
