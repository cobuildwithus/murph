# Diagnose owner contact labels in live group rosters

Status: active
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

1. Add one privacy-safe terminal outcome at the address-book read boundary.
2. Collapse group-tool timeout and rejection handling into the existing lookup
   wrapper.
3. Add focused regression and privacy assertions.
4. Verify, review, open the PR, deploy, and inspect one live retest.

## Evidence

- Two separate production group reads returned successful two-person rosters
  without any advisory label fields.
- Both dynamic tool calls completed well below the lookup deadline.
- The owner, consent, projection, contact count, and crypto-envelope state are
  present, leaving a small set of currently silent lookup exits.
