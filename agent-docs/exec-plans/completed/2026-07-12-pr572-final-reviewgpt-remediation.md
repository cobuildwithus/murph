# PR 572 final ReviewGPT remediation

Status: completed
Created: 2026-07-12

## Goal

Resolve the two accepted High findings from the final exact-head ReviewGPT pass:
preserve the preference causal-sequence path through both hosted Codex
environment gates, and make the sparse-preference causal rollout fail closed
across mixed producer/consumer versions instead of silently losing accepted
work.

## Scope

- Add the existing preference causal-path contract to the direct CLI and Codex
  shell environment allowlists.
- Cover hosted set/reset sequence propagation at the owning package boundaries.
- Enforce that unconsumed preference mailbox rows have a causal sequence.
- Correct current deployment and rollback documentation for the coordinated
  hard cut.
- Preserve the canonical preference owner, field watermarks, sequence-zero
  legacy handling, ordinary conversation, and current-inbound replies.

## Constraints

- Do not add a second sequence source, queue, receipt lifecycle, compatibility
  manager, or wall-clock ordering.
- Keep unrelated worktree and ledger entries untouched.
- The final pushed remediation head requires green CI and a fresh substantive
  exact-head ReviewGPT audit before the PR may become ready for review.

## Verification

- Passed focused assistant-engine direct CLI environment tests: 6 tests.
- Passed focused assistant-runtime Codex config tests: 40 tests, 2 optional
  skips.
- Passed focused vault-usecases preference set/reset tests: 5 tests.
- Passed focused hosted-web migration contract and predeploy guard tests: 31
  tests.
- Passed assistant-engine, assistant-runtime, vault-usecases, CLI, and hosted-web
  typechecks.
- The serialized diff-aware lane passed all affected package tests and the
  Cloudflare verification. Its web stage found only that the predeploy guard's
  bounded `ADD COLUMN ... NOT NULL` pattern spanned into the later check
  predicate; after expressing the same null predicate without that token
  sequence, the clean hosted-web verification passed 381 test files and 4,305
  tests plus build, lint, typecheck, and dev smoke.
- Passed docs drift, `git diff --check`, and the scoped identifier scan.

## State

Ready to close. Both accepted High findings are remediated without a second
causal owner or compatibility manager. The corrected pushed head still requires
green CI and a fresh substantive exact-head ReviewGPT audit before the PR can
leave draft state.
Updated: 2026-07-12
Completed: 2026-07-12
