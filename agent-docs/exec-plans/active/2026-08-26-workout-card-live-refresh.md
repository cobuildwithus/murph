# Workout card live refresh

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Progress

- Root cause proved from bounded production evidence: the accepted member
  action waited behind idle-checkpoint preparation, then canonical application
  completed promptly once imported. The transcript card remained its original
  embedded snapshot by design.
- Tasks 1-5 are implemented in the backend and companion worktrees. ReviewGPT's
  first native pass rejected the schema-7 and duplicated-result design; the
  accepted rewrite preserves V4/V6 and decodes refresh results through the
  existing card reader.
- ReviewGPT's first backend pass found that a workout-id-only refresh prefix
  could re-arm a stale positional card after a hidden reorder. The accepted
  correction binds that prefix to ordered hidden structure, restores the
  initial editor's logged-state equality guard, and proves both reorder
  rejection and result-save refresh through the real vault boundary.
- Every affected package and Web typecheck passes. Full contracts (328),
  operator-config (385), vault-usecases (381), assistant-runtime (2,508 pass,
  5 skip), and hosted-execution (557) tests pass, along with 78 focused Web
  member-action and changelog tests.
- Companion formatting, source parsing, strict-concurrency API/workout-core
  typechecks, project generation, and review-workflow verification pass.
  Simulator, XCTest, and physical Messages proof remain blocked because the
  current host has Command Line Tools but no Xcode or iOS SDK.
- Coordinated draft PRs are open. Remaining: finish broad verification, push
  corrected exact heads, run ReviewGPT to PASS, complete exact-head CI, record
  the native verification gap, and archive this plan with the final backend
  commit.

## Goal

- Make a workout-card save reach the canonical workout without waiting behind
  an idle snapshot, then let the expanded Messages reader replace an old
  embedded workout snapshot with the latest canonical state.

## Success criteria

- A `member.action.requested` wake that arrives while a dirty runtime is waiting
  to checkpoint runs before the idle snapshot when no conversation work is
  waiting.
- The immutable transcript bubble remains readable and unchanged, while an
  expanded active V6 workout reader attempts one authenticated refresh and
  renders the returned ordinary V4/V6 card URL through its existing decoder.
- Refresh resolution uses the V6 binding's stable lookup prefix only within the
  member authorized by the Messages-scoped bearer. Writes still require the
  complete exact-state token; the binding is neither identity nor authority and
  a forwarded or unmatched card fails closed.
- Network, credential, unsupported-reader, completed-workout, and projection
  failures retain the complete embedded snapshot without erasing a local
  draft or claiming freshness.
- Release the compatible iOS reader first, then enable the backend path and
  publish the changelog claim. Either release skew retains the embedded V4/V6
  card. No producer flag or new installed-reader schema floor is introduced,
  and Product UX stays on Hold until physical Messages proof exists.

## Scope

- In scope: pre-checkpoint safe-wake classification, a composite lookup-plus-
  state action binding, the closed workout-snapshot member request and typed
  card-URL result, the Messages refresh lifecycle, focused tests, governing
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

1. Risk: the stable half of an opaque binding correlates multiple snapshots of
   one structurally unchanged workout. Mitigation: derive it from the
   high-entropy canonical workout id and ordered hidden positional identity
   with a domain-separated one-way hash, expose no raw fields, require the
   member-scoped bearer, and scan only that member's canonical workout records.
   The other half retains the last-action generation for exact stale-write state.
2. Risk: a refresh races a local unsaved draft and silently discards edits.
   Mitigation: keep one selected-message session and replace it only when the
   entire draft equals its baseline, no request is admitted, and state is idle.
3. Risk: a wake notification is consumed before a long snapshot and leaves the
   accepted request queued.
   Mitigation: admit the complete safe `member.action.requested` prefix through
   the foreground-causal pre-checkpoint path and pin ordering with an entrypoint
   regression.
4. Risk: a new card schema or parallel result model establishes a rollback
   floor and duplicates validation. Mitigation: emit only ordinary V4/V6 URLs
   and pass the result through the existing native card decoder.
5. Risk: an original card lacks enough trusted plan information to reconstruct
   changed structure.
   Mitigation: preserve exact target labels only for matching coordinates;
   otherwise return no fresh projection instead of inventing or shifting a
   target.

## Tasks

1. Add the member-action wake to the existing pre-checkpoint-safe classifier
   and prove it runs ahead of an idle snapshot without outranking conversation.
2. Split the existing V6 binding into stable lookup and exact-state halves while
   preserving its 64-hex wire, legacy exact matching, V4/V6 historical readers,
   and the static V4 image path.
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
- One ordinary card URL is the refresh result; no second native workout/editor
  hierarchy or presentation owner is permitted.

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
