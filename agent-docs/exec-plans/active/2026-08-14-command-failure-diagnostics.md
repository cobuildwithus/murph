# Privacy-safe command failure diagnostics

Status: active
Created: 2026-08-14
Updated: 2026-08-14

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
- Persisted command issues add only `search` or `unknown` family, a bounded
  failure class, and a turn-local command ordinal. A later successful direct
  search marks an earlier direct-search failure recovered on the same in-memory
  issue object before the turn returns.
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
4. [ ] Run focused tests and relevant typechecks, then complete review gates.
5. [ ] Close the plan, commit with the repository helper, push, and open an
   unmerged PR.

## Verification log

- The existing per-completion helper cannot classify events whose completion
  omits `command`; App Server start events can carry the missing value.
- Review GPT accepted the implementation prompt and repository package. Its
  exact thread remains under the requested bounded watcher; no response or
  artifact has been returned yet, so no generated patch has been trusted or
  applied.
- Baseline focused assistant-engine coverage passed. The focused Web test used
  the repository's ordinary Prisma generation step for this fresh worktree.
- The tracker retains only a bounded `search` or `unknown` enum and a command
  ordinal beside an in-memory provider item key. Numeric shell-convention
  classes cover timeout, not-executable, and not-found exits; other direct
  search errors and generic nonzero exits stay distinct.
- A successful later direct search mutates only the still-local safe details
  object already held in `runtimeIssueInputs`. Provider-turn coverage proves
  that `recoveredAfterFailure` is finalized before the result reaches the
  existing best-effort persistence handoff. It is intentionally family-level,
  not exact-query matching.
- Focused assistant-engine tests pass (4 selected tests across 2 files), the
  focused hosted Web persistence test passes (3 tests), and assistant-engine
  plus Web typechecks pass. Prisma generation was the only required fresh-
  worktree bootstrap for the Web test.
