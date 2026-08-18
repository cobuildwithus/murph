# Accept equivalent mailbox timestamps for member actions

Status: completed
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Ensure standards-valid native member actions reach the canonical workout owner when
  their timestamp and the database projection represent the same instant with different
  ISO-8601 precision.

## Success criteria

- Mailbox import accepts equivalent ISO-8601 instants without weakening the remaining
  encrypted item identity checks.
- A focused regression test covers native-style timestamps without fractional seconds.
- Hosted runtime and mailbox tests, package typechecks, and required review gates pass.

## Scope

- In scope: the mailbox consumer identity comparison and its focused tests.
- Out of scope: native UI behavior, database repair, a new queue, or changes to the
  member-action wire schema.

## Constraints

- Technical constraints: preserve AAD validation, user/kind/event identity, and exact
  optimistic workout preconditions; compare only already-validated timestamps by instant.
- Product/process constraints: keep production evidence private, use the existing mailbox
  owner, and ship the smallest backward-compatible consumer correction.

## Risks and mitigations

1. Risk: a broader identity comparison could admit a payload for the wrong item.
   Mitigation: retain exact user, event, kind, and encrypted metadata checks and relax only
   timestamp representation after parsing both values as finite instants.
2. Risk: fixing only new producers leaves already-authored native representations invalid.
   Mitigation: correct the compatibility reader instead of requiring a producer rollout.

## Tasks

1. Add a focused failing mailbox-bridge test for equivalent timestamp representations.
2. Implement the narrow consumer identity correction.
3. Run focused tests, package typechecks, and scoped verification.
4. Commit, push, open the PR, and complete the required ReviewGPT/CI loop.

## Decisions

- Keep the wire schema unchanged; ISO-8601 strings with and without fractional seconds are
  already admitted by the public member-action contract.
- Treat timestamp equality as instant equality at the mailbox projection boundary because
  PostgreSQL canonicalizes the plaintext column while the encrypted wake preserves producer
  representation.

## Verification

- Commands to run: focused assistant-runtime mailbox tests, hosted-execution tests,
  affected package typechecks, and repository-prescribed PR verification.
- Expected outcomes: equivalent instants import successfully; mismatched instants and all
  other identity mismatches remain blocked.
Completed: 2026-08-15
