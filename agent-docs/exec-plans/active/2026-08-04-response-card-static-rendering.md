# Response card static-rendering hotfix

Status: active
Created: 2026-08-04
Updated: 2026-08-04

## Goal

- Make every accepted daily-nutrition iMessage app card visibly render in the
  transcript while preserving the existing immutable payload, outbox owner,
  and tap-through native reader.
- Label incomplete nutrition coverage as partial without adding another send,
  queue, persisted state owner, or remote card service.

## Root-cause evidence

- Consecutive production attempts reached the existing outbox, Linq accepted
  each app-card send, and provider delivery receipts completed without an
  error, while the recipient saw no bubble content.
- The reported V2 shape is accepted by both shared backend validation and the
  shipping iOS decoder: per-metric support may be lower than the card meal
  count, and nullable goals are valid.
- The interactive Linq mode delegates the transcript balloon entirely to the
  installed Messages extension. The release enabled that handoff while
  production-device presentation gates were still incomplete, so provider
  delivery did not prove a visible result.
- Linq's documented static mode always renders the supplied layout and retains
  the same URL for tap-through, which corrects the failing presentation
  boundary without changing delivery ownership or card truth.

## Success criteria

- The Linq app-card request always selects the provider-rendered static layout.
- The same bounded inline URL remains attached so tapping the card opens the
  existing offline Messages reader.
- A card with any metric supported by fewer meals than its top-level meal count
  visibly says `PARTIAL TOTALS`.
- Complete cards remain neutral, and static/fallback copy remains free of
  dates and nutrition values.
- Empty model-authored text continues to deliver the one card through the
  existing deterministic response-card text and outbox path.

## Scope

- Linq app-card presentation mode and layout derivation.
- Focused response-card/provider request tests.
- Response-card architecture, reliability, and iMessage-deliverability docs.

## Constraints

- No schema, database, API, queue, retry owner, extension network, or new
  dependency.
- Do not send a second text message after an accepted app-card attempt.
- Keep the clean fallback body so Apple's data-detector text downgrade cannot
  suppress the card presentation.

## Tasks

1. [x] Add the static layout and exact partial-card regression coverage.
2. [x] Run focused tests, typecheck, and secret-safe diff review.
3. [ ] Push the exact candidate, run required ReviewGPT gates with CI, and
   resolve every accepted finding.
4. [ ] Close this plan through the scoped final commit and hand off deployment
   verification.

## Verification log

- Production evidence showed successful outbox dispatch, Linq acceptance, and
  Apple delivery receipts for the invisible attempts, isolating the defect to
  the live Messages-extension presentation boundary.
- The operator-config focused response-card/provider suite passed: 56 tests in
  two files.
- The full operator-config suite passed: 250 tests in 29 files.
- Existing provider-to-channel card handoff coverage passed: 82 tests in two
  assistant-engine files.
- The new empty-authored-text response-card regression passed directly.
- Operator-config and assistant-engine package typechecks passed.
- Agent-doc drift and doc-gardening checks passed with zero issues.
- `git diff --check` and the changed-file identifier scan passed; no direct
  member or local-user identifiers are present in the change.
