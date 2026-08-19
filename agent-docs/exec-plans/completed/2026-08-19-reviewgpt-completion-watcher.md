# Prefer completion-triggered ReviewGPT waiting

Status: completed
Created: 2026-08-19
Updated: 2026-08-19

## Goal

- Make ReviewGPT waiting completion-triggered so agents do not spend active
  turns repeatedly checking a review that is still running.

## Success criteria

- The top-level agent workflow prefers tool-owned completion waiting and a
  detached watcher that resumes Codex only after ReviewGPT completes.
- Any unavoidable status polling is no more frequent than once every five
  minutes.
- The canonical ReviewGPT loop explains normal waited runs, out-of-turn watcher
  handoffs, timeout ownership, and the manual-poll fallback.
- Focused policy checks and diff validation pass.

## Scope

- In scope: `AGENTS.md`, the docs index, the workflow router, and the canonical
  ReviewGPT loop.
- Out of scope: changing ReviewGPT's internal response-capture implementation
  or the specialized Frog autofix worker.

## Constraints

- Technical constraints: preserve the existing 180-minute response-capture
  timeout and 240-minute implementation-handoff wake timeout as separate
  bounds.
- Product/process constraints: keep `AGENTS.md` compact and make the detailed
  ReviewGPT owner canonical.

## Risks and mitigations

1. Risk: agents mistake a completion-blocking wait for wasteful status polling.
   Mitigation: state that a tool-owned wait returning on completion is the
   preferred path and is not a manual status poll.
2. Risk: a detached watcher resumes the wrong session or thread.
   Mitigation: retain the exact-thread, capture-metadata, owning-session, and
   managed-lane requirements already enforced by ReviewGPT.

## Tasks

1. [x] Add the compact top-level workflow rule.
2. [x] Add detailed wait and wake ownership to the canonical ReviewGPT loop and
   route agents to it.
3. [x] Run readback, reference checks, the focused policy coverage test, and
   final diff inspection.

## Decisions

- Prefer `--wait` for an active normal review run.
- When a review must outlive the active turn, prefer detached `thread wake`
  handoff so the watcher resumes Codex only after completion.
- Permit manual status checks only when completion notification is unavailable,
  with at least five minutes between checks.

## Verification

- Passed `scripts/check-agent-docs-drift.sh`, `git diff --check`, targeted policy
  token checks, stale-reference searches, and the private-identifier scan.
- The exact CLI release policy file passed 46 tests, including its real release
  tarball audit.
- Full acceptance passed typechecks, documentation checks, package-shape and
  repository guards, lint, development smoke proof, the web suite, production
  compilation, and most package coverage. Seven runtime assertions failed only
  under heavy parallel contention; the exact affected files then passed all
  484 assertions serially on the same candidate head.
- A fresh remote acceptance run independently passed the visible build and test
  lanes, including the release-tarball test, before its wrapper reported a
  post-verification model-call failure.
Completed: 2026-08-19
