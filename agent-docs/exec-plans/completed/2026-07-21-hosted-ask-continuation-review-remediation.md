# Hosted ask continuation ReviewGPT remediation

Status: completed
Created: 2026-07-21
Updated: 2026-07-22

## Goal

Remediate PR #840 ReviewGPT round-one findings so an older completed hosted Ask
is delivered before a pending personal reply, while the dirty-window group Ask
optimization remains bounded and never advances the idle workspace snapshot.

## Success criteria

- The exact oldest `assistant.ask.completed` item that predates the oldest
  pending personal input is retained until its stable-key outbox intent is
  terminal; pending, retryable, and in-flight delivery block that personal
  reply, while newer completions do not jump it. If an earlier background pass
  already removed the item, its older nonterminal stable-key completion intent
  remains the same barrier.
- Pending-effects work and unrelated outbox backlog cannot mask or replace the
  exact Ask prerequisite.
- Dirty-window import consumes only a contiguous leading
  `assistant.ask.requested` prefix, stops before unrelated system work, and
  admits only `joined_group` targets.
- No new queue, scheduler, state machine, or early idle snapshot is introduced.
- Focused tests, owner verification, CI, and ReviewGPT pass on the final PR head.

## Constraints

- Preserve the mailbox and outbox as the only durable owners and reuse the
  existing deterministic completion delivery key.
- Keep the expensive idle workspace snapshot on its existing idle/shutdown
  schedule; foreground runtime dirty bookkeeping is not a snapshot trigger.
- Preserve unrelated active work, especially the overlapping mailbox
  consumption lane.
- Keep private group content, health details, member identifiers, and local
  machine identifiers out of durable artifacts.

## Approach

1. Separate the existing pending-effects preflight from an exact Ask completion
   barrier keyed by mailbox item and deterministic outbox intent.
2. Retain that exact mailbox item through delivery terminality and re-enter the
   existing foreground loop afterward; recognize the already-materialized
   stable-key intent if ordinary maintenance removed the mailbox item first.
3. Add a mailbox-prefix predicate plus joined-group import context for the
   dirty-window optimization, leaving all other rows on the ordinary lane.
4. Add focused causal-order, retry, replay, prefix, target-kind, and no-early-
   snapshot proof; update the live protocol and index.
5. Run required verification and coverage audit, commit/push the remediation,
   then complete ReviewGPT and exact-head CI without merging the PR.

## Review findings being remediated

- High: the prior generic causal allowlist could release personal delivery
  without selecting or terminally delivering the exact older Ask.
- Purpose drift: the prior dirty-window page scan could import unrelated system
  work and accelerate reverse consented-member reads.

## Verification

- Assistant Runtime full suite: passed, 1,799 tests passed and 2 skipped.
- Assistant Runtime package typecheck: passed.
- Focused mailbox prefix, target-kind, exact-selection, retry, replay, and
  already-materialized outbox, dirty-window no-early-snapshot tests: passed.
- Diff-aware verification: passed, including 1,852 Cloudflare tests.
- Docs drift: passed.
- Repo acceptance verification and coverage: passed.
- Remaining PR-lane gates after this plan closes: remediation commit/push,
  ReviewGPT round two, and exact-head CI.
Completed: 2026-07-22
