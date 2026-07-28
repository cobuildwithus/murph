# Diagnose owner contact labels in live group rosters

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Preserve the truthful live participant roster while making the optional
  owner address-book overlay's terminal outcome observable without exposing
  contact data or identifiers.
- Use one production retest to prove the remaining root cause before changing
  label behavior.

## Success criteria

- Every owner address-book advisory lookup emits one bounded, secret-safe
  terminal outcome for normal completion, timeout, or failure.
- Logs contain only coarse outcome codes and bounded counts, never handles,
  names, member IDs, tokens, ciphertext, or secrets.
- Existing roster and label behavior remains unchanged.
- Focused tests cover matched, no-match, ambiguous, gated, failed, and timed-out
  outcomes.
- Required verification and ReviewGPT review pass for the exact PR head.

## Scope

- Hosted address-book advisory-name reads.
- Hosted group participant overlay failure and timeout ownership.
- Focused address-book and group-tool tests.

## Constraints

- Do not add an ops page, persisted diagnostics, a new service, or a second
  state owner.
- Do not guess at a behavioral fix until production identifies the terminal
  outcome.
- Keep advisory labels untrusted and optional.

## Tasks

1. Added a structured, privacy-safe terminal outcome at the address-book read
   boundary.
2. Collapsed timeout, rejection, and diagnostic ownership into the existing
   group-tool lookup wrapper.
3. Added focused matched, no-match, ambiguous, gated, disabled, failed,
   timed-out, and late-settlement regression coverage.
4. Opened the diagnostic PR and completed the preliminary specialist review.
   Final PR gating and the live retest follow the repository release workflow.

## Evidence

- Two separate production group reads returned successful two-person rosters
  without any advisory label fields.
- Both dynamic tool calls completed well below the lookup deadline.
- The owner, consent, projection, contact count, and crypto-envelope state are
  present, leaving a small set of currently silent lookup exits.
- Focused Vitest verification passed with 106 tests.
- Scoped lint and the hosted-web prepared typecheck passed.
- The initial candidate passed the complete diff-aware hosted-web verification
  lane. The post-review rerun passed repository guards and then exceeded the
  documented shared-host admission wait; its prescribed isolated fallback
  failed before dispatch because the installed delegate rejected the wrapper's
  lifecycle option.
- ReviewGPT identified split terminal logging ownership and two missing exit
  assertions. The final implementation gives the deadline wrapper sole logging
  ownership and covers late success, late rejection, noncanonical input, and a
  disabled projection without changing roster behavior.
Completed: 2026-07-28
