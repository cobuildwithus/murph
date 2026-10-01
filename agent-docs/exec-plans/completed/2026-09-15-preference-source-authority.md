# Bind batched preference updates to their requesting input

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Goal

Keep conversation batching across system events while preserving the source order
of style, persona, tone, and voice requests. Prepare the verified correction for
PR #3467. The PR owns subsequent exact-head CI and final review evidence.

## Cause and decision

An older preference instruction could borrow the terminal accepted input's
authority when batching crosses a newer Settings write. Select the requesting
accepted message for each preference mutation. Reuse the current accepted-input
scope and Web's canonical timestamp/sequence lookup and stale-write checks.
No additional queue, persisted state, or Web authority owner is needed.
Assistant configuration has no timestamp-based preference ordering; its existing
behavior is independent of this regression and is outside this correction.

## Tasks and proof

- Add a model-facing message ref to style and personalization mutations; validate
  membership in the current accepted scope and fail closed on ambiguity.
- Preserve reads, one-message contexts, local style, and scheduled authority.
- Exercise initial and live accepted-input scopes, source selection, stale no-op,
  later intent, invalid refs, and ordinary device-gap batching.
- Run focused deterministic tests and typechecks, then a real-Codex synthetic
  source-selection journey with production prompt and tool builders.
- Update the authority owner docs and PR evidence. Commit, push, and start fresh
  ReviewGPT on the stable head concurrently with required CI.

## Product UX

Older queued preferences must not override newer saved settings. A later explicit
request must still apply. Ordinary messages still receive one combined answer.
Tool failures must not claim a preference was saved.

## Verification

- Engine style, personalization, scheduled, and completion-authority suites:
  41 tests passed on the final authority implementation.
- Web canonical personalization and member-preference suites: 62 tests passed.
  Newer Settings defeats older intent; a later explicit request still applies.
- Engine typecheck passed, including the live-model test fixtures.
- Complexity passes with no added debt (433 remains 433) or maximum increase
  (139 remains 139); the changed authority helper is below the threshold.
- Docs drift and whitespace checks passed.
- Complete first-provider-input capture uses synthetic direct/group fixtures and
  a credential-free local scripted provider. Exact Terra tokenization is not
  available; the PR records complete UTF-8 byte measurements and exclusions.
- Live direct and group source-selection journeys passed on gpt-5.6-terra with
  local subscription auth. Each made exactly the two requested writes, using the
  earlier message for Humor and the later message for tone. Replies correctly
  reported Humor 0 and sentence case. Reply review: Ready.
- The live assertion permits one read-only verification of the current score the
  user asks for; it still forbids extra writes, unrelated actions, and failures.
- Final guidance clarifies that an exact tone/voice update returns the saved value.
  Its focused personalization tests passed (12 tests), as did full-input capture.
- Candidate implementation and local verification are complete. PR #3467 owns
  subsequent exact-head CI and the required second final-review round.
- Parent review confirms no new state or external work, unchanged signed Web
  authority shape, and compatible existing record shapes. Roll back batching
  together with its preference-source correction, not either half separately.
Completed: 2026-09-15
