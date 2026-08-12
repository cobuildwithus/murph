# Workout Card Capacity And Native Overflow

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Let a member keep a large live strength workout in one canonical session and
  receive a complete interactive iMessage card after each verified mutation.
- Keep long native workout snapshots usable inside Messages without clipping
  exercises or sets.

## Success criteria

- The assistant updates the canonical live workout and attaches the refreshed
  card in the same response whenever the verified snapshot fits the supported
  bounded contract; it does not refuse merely because the workout exceeds the
  former ordinary six-exercise/four-set fixture.
- The immutable offline envelope stays below the provider's 2,048-character URL
  ceiling and contains no identity, canonical record reference, credential, or
  write authority.
- The iOS Messages extension strictly decodes the compatible bounded envelope,
  keeps transcript previews explicitly compact, and gives the complete workout
  detail an owned vertical scroll surface with accessible actions.
- Focused contract, prompt, cross-platform fixture, Swift decoder/view, format,
  and simulator tests pass; exact-head ReviewGPT and required PR checks pass in
  both repositories.

## Scope

- In scope: Murph workout-card bounds/encoding, assistant prompt and tracked
  workout skill, deterministic fallback/static contract, focused tests and
  durable docs; downstream iOS decoder, expanded Messages workout layout,
  synthetic visual proof, and focused tests/docs.
- Out of scope: mutable app-owned workout state, remote card storage/fetching,
  card-specific queues, hiding or dropping canonical exercises/sets, changing
  workout mutation authority, or expanding the companion into a chat client.

## Constraints

- Technical constraints: immutable offline fragment; 2,048-character URL cap;
  strict closed schemas; complete semantic text fallback; existing canonical
  workout event remains the only state owner; independently deployed producer
  and native reader must have a safe compatibility window.
- Product/process constraints: confidential screenshots may guide the fix but
  cannot enter repository artifacts; preserve unrelated work; iOS reader ships
  before the backend producer; use task worktrees, scoped commits/PRs, exact-head
  ReviewGPT, CI, and physical-device gaps called out honestly.

## Risks and mitigations

1. Risk: Increasing logical bounds makes valid snapshots exceed the provider
   URL ceiling.
   Mitigation: prove the maximum supported shape through the real encoder and
   keep validation tied to encoded length; reject only truly unrepresentable
   snapshots with deterministic complete text fallback.
2. Risk: A new wire breaks already-installed readers or persisted outbox state.
   Mitigation: prefer a backward-compatible V4 extension when possible; if a
   new schema is proven necessary, land a strict additive native reader first
   and document the rollback floor before enabling its producer.
3. Risk: An outer ScrollView fights Apple's transcript host sizing or nested
   controls.
   Mitigation: constrain scrolling to expanded workout detail, preserve compact
   transcript intrinsic sizing, and cover long content plus accessibility in
   the Card Studio/simulator tests and rendered evidence.

## Tasks

1. Trace the current authoring schema, encoder, tool/prompt decision, provider
   delivery, Swift decoder, and expanded layout; reproduce both capacity refusal
   and native clipping with synthetic large workouts.
2. Send the exact relevant slice and proven reproduction to ReviewGPT, request
   an apply-ready patch, and triage the result against the privacy, ownership,
   simplicity, and compatibility invariants.
3. Implement the smallest bounded Murph contract/prompt correction and focused
   tests/docs.
4. Implement the downstream iOS decoder/layout correction and focused
   tests/docs/visual evidence.
5. Run focused verification and final parent review; commit, push, open linked
   PRs with deployment order and exact-head evidence; run ReviewGPT concurrently
   with required hosted checks and remediate all accepted findings.

## Decisions

- Murph is the source-of-truth repo; murph-ios is the downstream reader.
- Do not solve capacity by truncating the card or introducing a remote card
  owner. Complete workout meaning and offline rendering remain required.
- Raise the V4 logical authoring/reader bounds to 16 exercises and 16 sets per
  exercise. Keep measured fragment and image-path length as the final gate for
  every complete card instead of treating the count ceiling as a size estimate.
- Keep the transcript bubble intrinsically compact by showing four exercise
  summaries and a remaining-count row. The existing expanded presentation
  remains the single scroll owner and renders every exercise.
- Put the no-size-guess rule in the routed tracked-workout skill and response
  card tool description rather than expanding the already budget-capped
  always-on prompt kernel.
- ReviewGPT round 1 proved that transport-size rejection happened before the
  trusted renderer could retain semantic workout state. Separate semantic
  workout validation from measured envelope admission at the existing tool
  boundary; only a semantically valid oversize workout enters request-local
  text recovery, while malformed input retains the ordinary validation error.
- The unchanged V4 discriminator does not remove strict-reader rollout floors.
  Release the native reader, then Web, then the Worker and runner together; once
  an expanded V4 card is sent or persisted, recover by forward fix and explicit
  quarantine restoration rather than rollback below those reader versions.
- Defer the public changelog fragment until producer enablement, after the iOS
  reader and all backend reader floors are live and production smoke passes.

## Verification

- Commands to run: targeted pnpm/Vitest tests and typecheck for changed Murph
  packages; xcodegen, swiftformat lint, focused xcodebuild tests, and simulator
  render proof for murph-ios; exact-head CI and ReviewGPT in both PRs.
- Expected outcomes: synthetic large workouts encode and render completely
  within the supported bound; over-bound input fails safely to complete text;
  long expanded cards scroll without clipping; all changed-surface checks pass.
- Completed local proof so far: combined contract, tool, assistant app-server,
  local outbox, hosted side-effect, and Web static-route suite passes (408/408),
  including literal 16×16 bounds, trusted text recovery for a real oversized
  semantic workout, and final-exercise retention through every strict backend
  reader. Typecheck passes for contracts, operator config, assistant engine,
  hosted execution, and hosted Web. XcodeGen and SwiftFormat lint pass. Direct
  simulator compilation and render of the exact production iOS view files
  proves the compact 11×3 transcript state. Repository Xcode attempts still
  stall before target compilation while waiting for build workers or package
  loading; each session-owned command was interrupted, so the ordinary Xcode
  build/test and physical Messages journey remain explicit release blockers.
- Preliminary ReviewGPT returned findings. Its attached test-only 16×16 boundary
  patch was inspected, applied, and verified; its semantic-recovery finding was
  reproduced and fixed. Final ReviewGPT round 1 independently found the same
  recovery gap plus the undisclosed Web/outbox/hosted rollout floor and premature
  changelog timing. All three are accepted and addressed on the remediation
  candidate. iOS ReviewGPT round 1 passed the exact screenshot-bearing head with
  no source-level finding.

## ReviewGPT round 2 retrospective

- Trigger: round 2 found the same presentation-authority mechanism at the exact
  scheduled-notification owner. The line-count threshold is not the trigger:
  first-reviewed source was +5/-4, while the round-2 candidate was +231/-16.
- Original requirement: every retained private route that can attach the workout
  card must deliver the complete verified workout in that occurrence—interactive
  when the measured envelope fits, trusted text when it does not.
- Root architectural mismatch: the provider result already distinguishes the
  provider-authored scheduled JSON envelope from runtime-owned final response
  and transcript presentations, but the notification owner consumed the final
  presentation only when `responseCard` was non-null. A cardless overflow thus
  succeeded inside the provider turn and was discarded downstream.
- Product decision: retain scheduled card eligibility. The durable provider
  invariant requires a scheduled occurrence to use the ordinary planner and
  dynamic-tool eligibility, and fitting scheduled cards already have production
  behavior and regression coverage. Removing eligibility would degrade that
  existing flow.
- Architecture decision: make the existing notification owner consume the
  existing provider result's final `response` whenever it differs from the
  provider-authored delivery envelope, and persist its existing
  `transcriptResponse`. The structured decision continues to own send/skip,
  subject, and private summary only. A runtime-owned presentation paired with a
  provider skip remains invalid, matching the existing fitting-card guard.
- Complexity decision: delete the notification owner's duplicate card renderer;
  add no schema, queue, durable field, lifecycle, compatibility path, or new
  state owner. Focused notification tests cover fitting-card send, cardless
  overflow send, transcript authority, and rejection of a cardless-overflow
  skip so cron cannot terminalize it as a no-op.

## ReviewGPT round 3

- ReviewGPT verified every prior accepted correction, including the round-2
  retrospective, then found one original cross-channel scope omission: raising
  the shared workout contract necessarily expands Telegram rich workout cards
  because private direct and exact scheduled Telegram turns already use the
  same response-card planner and projector.
- Accept the finding without a channel fork. Disclose Telegram as an affected
  surface and add production-adapter proof that an 11-exercise, 33-set workout
  uses one rich message containing its first and last exercise/set, while a
  semantically valid 16x16 workout fails measured card admission and uses the
  complete tracking-free text path.
- Run the existing scheduled overflow proof with a Telegram delivery channel
  for both send-or-skip and require-send policies, asserting complete delivery,
  authoritative transcript persistence, and illegal-skip rejection. Add no
  Telegram-specific bound, flag, schema, renderer, or compatibility mechanism.
- Corrected-head broad Murph CI passed before this test-only disclosure
  remediation. The linked iOS exact-head hosted verification and ReviewGPT
  round 1 also passed; repository Xcode worker/package-loading stalls and a
  physical Messages journey remain explicit downstream release gates.

## ReviewGPT round 4 retrospective

- Trigger: round 4 found the same affected-surface-inventory mechanism as
  round 3. The Telegram-only remediation followed one named channel instead of
  deriving every production journey from the channel-independent
  `responseCardsAvailable` planner and registered adapter graph. The earlier
  presentation-authority retrospective did not cover this route-inventory
  mechanism, so a separate retrospective is required.
- Complete route matrix: private direct and exact scheduled response-card turns
  reach Linq, Telegram, and email. Linq projects a fitting workout to the native
  Messages card; Telegram projects it to rich HTML; email intentionally treats
  the card as transport-inert and sends the same complete deterministic text.
  Every channel uses complete tracking-free text for genuine measured overflow,
  while transcript persistence retains the canonical tracking authority.
- Product decision: keep workout-card semantics channel-independent because the
  ordinary planner already offers the shared tool on all three private routes.
  The irreducible promise is complete verified workout meaning, not identical
  presentation: native or rich interaction where the adapter owns it, complete
  deterministic text otherwise. Scheduled JSON remains only the send envelope.
- Architecture decision: retain the existing shared semantic schema, measured
  admission gate, provider-result presentation authority, outbox, and adapter
  projectors. Add no channel-specific limit, schema, feature flag, renderer,
  state owner, queue, lifecycle, or compatibility mechanism.
- Proof decision: use one route matrix rather than another named-channel patch.
  Existing shared tests cover malformed input, 16x16 bounds, seventeenth-item
  rejection, direct Linq card/fallback, strict outbox/hosted readers, and
  visible-versus-transcript tracking separation. Production-adapter tests cover
  fitting and overflowing Telegram and email projections; scheduled tests run
  both response policies across Linq, Telegram, and email and reject skip after
  runtime presentation.
