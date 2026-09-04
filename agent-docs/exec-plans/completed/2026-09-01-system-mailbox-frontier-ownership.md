# System mailbox frontier ownership recovery

Status: completed
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Stop the hosted runtime from publishing contradictory owners when an ordinary
  default-owned row sits behind a model-free durable system-mailbox frontier.
  Temporal must see only the frontier owner until it advances, without requiring
  an unrelated foreground turn to bridge the state.

## Success criteria

- A focused regression reproduces an earlier locally restored recording/retry
  model-free item followed by later default-owned work.
- The later notification does not publish an independent default wake while the
  earlier model-free frontier owns execution.
- Removing the earlier frontier immediately exposes the notification to the
  default owner, proving that work is delayed rather than lost.
- Existing current-conversation and approved-continuation priority remains intact.
- Focused tests and the affected package typecheck pass.

## Scope

- In scope: hosted assistant system-mailbox wake-owner projection, its durable
  runtime contracts, and focused synthetic regression coverage.
- Out of scope: Temporal scheduling policy, mailbox schemas, device provider
  behavior, and the separate Cloudflare operator-task route allowlist fix.

## Constraints

- Technical constraints: preserve the documented default/foreground priority;
  reuse existing mailbox state and wake derivation; add no queue or state owner.
- Product/process constraints: use synthetic fixtures only; do not persist
  production rows, member identifiers, transcripts, or local-machine identifiers.

## Risks and mitigations

1. Risk: suppressing all default work could delay explicit member-approved
   continuations.
   Mitigation: preserve the existing approved-continuation foreground exception
   and cover it with the neighboring selector suite.
2. Risk: changing wake precedence could delay genuine foreground work.
   Mitigation: leave conversation ownership unchanged and retain the existing
   explicit approved-continuation exception in the shared projection.

## Tasks

1. Add a focused failing regression for restored local work with conflicting owners.
2. Implement the smallest correction in the shared wake-owner projection used
   by both execution and checkpoint scheduling.
3. Run focused tests, typecheck, and inspect the final diff for scope and privacy.
4. Commit, push a draft PR, and complete required exact-head review and CI gates.

## Decisions

- The failing regression proved the primary defect is upstream of Temporal and
  the empty-import return: wake derivation published a later default owner while
  execution selected the earlier model-free frontier.
- Preserve genuine foreground priority for current conversation work and
  explicitly approved continuations, but not ordinary background notifications.
- Treat the separate Web control-route allowlist omission as an independent fix.

## Verification

- Commands run locally: the mailbox-state, model-free notification, delegated
  direction, assistant scheduling, assistant foreground, and focused entrypoint
  Vitest suites; the assistant-runtime typecheck; complexity and diff checks.
  Exact-head GitHub checks and ReviewGPT remain PR gates.
- Expected outcomes: the regression fails before the fix and passes after it;
  existing approved-continuation and foreground-priority coverage stays green;
  no unrelated files or private evidence enter the diff.
Completed: 2026-09-01
