# Privacy-safe command failure diagnostics

Status: active
Created: 2026-08-14
Updated: 2026-08-15

## Goal

- Stop treating a provably direct `rg` or `grep` exit code 1 as an operational
  command failure while keeping every other nonzero command result observable
  through the existing assistant runtime-issue owner.

## Success criteria

- A command completion can reuse a bounded, in-memory safe classification from
  its matching start event when the completion omits the command.
- Only direct bare `rg` and `grep` executions with exit code 1 are exempted;
  wrappers, compound commands, unknown commands, and all other nonzero exits
  retain the current runtime issue.
- Persisted command issues add only a `search` or `unknown` family and a
  turn-local command ordinal saturated at 10,000. Exact numeric exit codes
  remain available without a redundant derived failure class. A later
  successful direct search marks an earlier direct-search failure recovered on
  the same in-memory issue object before the turn returns.
- Returned and durable issue metadata continues to exclude command text,
  arguments, paths, output, payloads, and provider identifiers.
- Focused assistant-engine and hosted persistence tests plus the relevant
  typechecks pass.

## Scope

- Codex action runtime-issue classification in `assistant-engine`.
- Focused propagation, no-match, duplicate-event, and privacy tests.
- Existing hosted Web persistence proof for the unchanged safe issue shape.

## Constraints

- Reuse the current `AssistantRuntimeIssueInput` flow and its existing cap.
- Add no database schema, durable state owner, queue, scheduler, or raw command
  logging.
- Keep command classification bounded and invocation-local.
- Keep the exact Review GPT watcher alive while the local candidate is built;
  inspect any response or attachment as untrusted before using it.

## Tasks

1. [x] Trace the current command event, issue propagation, sanitizer, export,
   and Web persistence owners.
2. [x] Implement the bounded turn-scoped classifier, attribution fields,
   direct-search no-match exemption, and same-family recovery marker.
3. [x] Add focused unit, provider-turn propagation, durable persistence, and
   privacy-negative coverage.
4. [x] Run focused tests and relevant typechecks, then reconcile the
   preliminary specialist review.
5. [x] Commit with the repository helper, push, and open an unmerged PR.
6. [ ] Reconcile the original Review GPT response, complete the final review
   gate, and close the plan.

## Verification log

- The existing per-completion helper cannot classify events whose completion
  omits `command`; App Server start events can carry the missing value.
- Review GPT returned a broad implementation patch after the local candidate
  was complete. The patch was inspected as untrusted, rejected because it
  widened the privacy and ownership surface, and no generated content was
  applied.
- Baseline focused assistant-engine coverage passed. The focused Web test used
  the repository's ordinary Prisma generation step for this fresh worktree.
- The tracker retains only a bounded `search` or `unknown` enum and a command
  ordinal beside an in-memory provider item key. Persisted issues keep the
  exact numeric exit code without restating the family and exit as a derived
  failure class. The ordinal saturates at a named cap instead of growing
  without bound.
- A successful later direct search mutates only the still-local safe details
  object already held in `runtimeIssueInputs`. Provider-turn coverage proves
  that `recoveredAfterFailure` is finalized before the result reaches the
  existing best-effort persistence handoff. It is intentionally family-level,
  not exact-query matching.
- Focused assistant-engine tests pass (4 selected tests across 2 files), the
  focused hosted Web persistence test passes (3 tests), and assistant-engine
  plus Web typechecks pass. Prisma generation was the only required fresh-
  worktree bootstrap for the Web test.
- The preliminary coverage specialist found that a blanket shell-control scan
  rejected ordinary quoted regex syntax. The corrected scan is transient and
  bounded, accepts quoted or escaped argument data, and still rejects
  executable shell control, command substitution, malformed quoting, newlines,
  and oversized labels conservatively.
- The exact-head preliminary re-check passed with no findings. Final ReviewGPT
  round 1 required removing the convention-dependent, redundant failure class;
  its separate body discrepancy identified the missing ordinal value cap.
  Round 2 verified the exact-exit and ordinal corrections, then required
  deleting the remaining two-value failure class because it was still fully
  derivable from the retained family and exit code.
- After the round-2 deletion, all four focused attribution and privacy tests,
  both full assistant-engine files (285 tests), and the focused hosted
  persistence file (3 tests) pass. Assistant-engine and Web typechecks also
  pass. Exact-head CI must rerun after this remediation.
