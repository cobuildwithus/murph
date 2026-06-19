# Hosted Mailbox Follow-Ups

## Goal

Fix hosted mailbox follow-up handling so rapid same-conversation input is admitted during an active turn, and harden mailbox consume acknowledgements against gaps, legacy fetch responses, terminal-skip batches, and incomplete pending-input indexes.

## Constraints

- Keep the architecture simple: no new scheduler, queue, persistent state owner, or compatibility layer.
- Preserve web-owned mailbox sequencing and consumed counters.
- Runtime may only acknowledge a contiguous, proven prefix after durable checkpoint and assistant-handling gates.
- Preserve unrelated working-tree edits outside this task.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/pending-input-index.ts`
- `packages/assistant-runtime/src/hosted-runtime/pending-assistant-input.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- Focused assistant-runtime tests

## Plan

1. Inspect current coverage, consumed-seq, pending-index, and active foreground import budget paths.
2. Add focused failing coverage for the ReviewGPT findings and the local rapid-follow-up repro.
3. Implement the smallest production fixes at the existing runtime/import ownership boundaries.
4. Run assistant-runtime focused tests, package verification, required audits, and final review.
5. Close this plan with a scoped commit.

## Progress

- Started 2026-06-18 on isolated branch `fix/hosted-mailbox-followups`.
- Implemented anchored conversation consume acknowledgements with explicit
  `baseConsumedSeq`, terminal-skip-only ack support, and pending-input index
  completeness backfill before wake/consume decisions.
- Fixed active-turn foreground mailbox starvation by not charging already
  durably consumed or locally imported replay rows against the fresh-input
  budget.
- Added replay-aware web mailbox cursors that fetch a fresh tail only when a
  replay gap exceeds the fetch cap, plus runtime import fast-forwarding over
  locally imported conversation gaps.
- Added regression coverage for rapid follow-ups, legacy missing consumed
  metadata, coverage holes, terminal-skip prefixes, incomplete pending indexes,
  stale restored local watermarks, and capped replay gaps.
- Verification passed: `pnpm typecheck`, assistant-runtime focused tests,
  `bash scripts/workspace-verify.sh test:diff ...`, `pnpm test:smoke`, and
  `git diff --check`. Final review subagent reported no high/medium findings.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
