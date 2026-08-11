# sponsorship-creative-explicit-consent

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Make group contributions quiet by default. Murph may produce a sponsor message,
  poem, or song only when an authorized participant explicitly selects that
  creative format during checkout.

## Success criteria

- A fulfilled contribution with no explicit creative request appends no creative
  mailbox notification, including rows created before this feature.
- An explicitly selected message, poem, or song produces exactly one bounded
  response in the selected format; only an explicit song request can expose the
  song-generation tool.
- Checkout recovery preserves the frozen explicit choice without reinterpreting
  absent or legacy data as song consent.
- Current group-funding UI work from the existing draft PR and current `main`
  remains intact, with desktop/mobile design-catalog proof.
- Focused tests and typechecks pass; required ReviewGPT and exact-head CI gates
  are green on the updated PR head.

## Scope

- In scope: the existing group-sponsorship draft contract, encrypted moment
  storage, fulfillment notification projection, creative notification profiles,
  checkout UI/recovery, tests, and durable product documentation.
- Out of scope: changing prices, granting or refunding credits, changing active
  sponsor caps, replaying historical notifications, or mutating production rows.

## Constraints

- Technical constraints: reuse the existing purchase digest, participant
  authority, encrypted private-content fields, fulfillment owner, mailbox
  idempotency, and design-catalog component; keep the migration additive and
  rolling-deploy safe.
- Product/process constraints: explicit consent is fail-closed; missing,
  malformed, or unauthorized creative state must be quiet. A pre-feature
  participant-authored generic note may remain a plain message, but never a
  song. Preserve unrelated changes and update the existing draft PR rather than
  opening a competing implementation.

## Risks and mitigations

1. Risk: stale rows or checkout retries are interpreted as implicit song
   consent.
   Mitigation: remove the legacy automatic-song fallback and cover null,
   sentinel, malformed, unauthorized, and recovered state directly.
2. Risk: current `main` and the draft branch both changed funding UI/prompts.
   Mitigation: reconcile with ordinary Git history, inspect every conflict as a
   semantic union, and run focused cross-package proof.
3. Risk: prompt/tool widening lets text-only requests invoke music generation.
   Mitigation: retain separate text/song notification profiles and executable
   tests proving the tool is exposed only for validated song requests.
4. Risk: a selected song silently degrades into an ordinary text response when
   generation fails.
   Mitigation: require exactly one generated voice-memo attachment before any
   receipt, transcript persistence, or delivery; otherwise use the existing
   optional-creative failure settlement without changing the granted credit.
5. Risk: permanently malformed optional creative content rolls back activation
   and controls unrelated Stripe settlement state.
   Mitigation: omit only schema-invalid creative content at the notification
   projection boundary after activation while preserving running-bit state;
   creator recovery stays strict and operational crypto/database failures still
   propagate.

## Tasks

1. Audit the draft PR and current production path against the explicit-consent
   invariant.
2. Reconcile the PR branch with current `main` while preserving both branches'
   intended behavior.
3. Delete implicit legacy song behavior and simplify the persisted/read model so
   absence always means quiet.
4. Update focused Web/runtime/assistant tests, durable docs, and the design study.
5. Run focused verification, inspect the final diff, then run the required
   preliminary specialist, final ReviewGPT, and exact-head CI gates.

## Decisions

- A pre-feature generic note remains eligible only as a plain-message request;
  it is never song consent. Legacy rows without a participant-authored note are
  quiet.
- Named style references are converted to broad traits under one system-level
  no-naming rule; the lower task prompt has no contradictory premise exception.
- A schema-invalid decrypted creative envelope settles quietly without rolling
  back activation or blocking receipt completion. Decryption and other
  operational failures remain retryable errors.
- No production data mutation is required for the code correction.

## Verification

- Focused Web sponsorship/store/dialog and adjacent billing suites pass (490
  tests across the final affected files).
- Hosted execution, assistant runtime, and assistant-engine focused suites pass,
  including explicit message/poem/song tool-boundary proof.
- Web, hosted execution, assistant runtime, and assistant-engine typechecks pass.
- Hosted Stripe billing guard, docs drift/gardening, changed-Web ESLint,
  design-proof checker tests, and `git diff --check` pass.
- Final ReviewGPT round 1 identified the song-to-text fallback. The accepted
  finding is corrected at the notification-turn delivery boundary; focused
  prompt and notification-runtime proof passes 55 tests and assistant-engine
  typecheck passes.
- The real design-catalog flow was rendered through the repository Playwright
  fallback at desktop and mobile viewports. Quiet-default and explicit creative
  states were inspected locally and after hosted proof upload.
- The preliminary specialist retry inspected eight exact-head desktop/mobile
  renders and found two gaps: malformed optional creative state controlling
  settlement, and conflicting reference-naming prompt rules. Both are corrected;
  277 focused Web tests, the focused assistant prompt test, changed-Web ESLint,
  Web typecheck, assistant-engine typecheck, and `git diff --check` pass.
- Final ReviewGPT round 2 audited the fresh full snapshot at `ecbdbb47b8` and
  returned `ROUND_OUTCOME: PASS` with no qualifying findings.
- Exact-head GitHub Actions at `ecbdbb47b8` are green, including release app
  verification, build/typecheck, assistant/CLI/platform coverage, billing,
  design proof, viewport, fixture, artifact, and host-matrix checks. The PR is
  mergeable and remains draft as requested.
- Remaining gate after archival: exact-head CI for the plan-archive-only commit.
Completed: 2026-08-09
