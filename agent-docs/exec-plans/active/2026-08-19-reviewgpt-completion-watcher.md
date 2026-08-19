# Prefer completion-triggered ReviewGPT waiting

Status: active
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

1. Add the compact top-level workflow rule.
2. Add detailed wait and wake ownership to the canonical ReviewGPT loop and
   route agents to it.
3. Run readback, reference checks, the focused policy coverage test, and final
   diff inspection.

## Decisions

- Prefer `--wait` for an active normal review run.
- When a review must outlive the active turn, prefer detached `thread wake`
  handoff so the watcher resumes Codex only after completion.
- Permit manual status checks only when completion notification is unavailable,
  with at least five minutes between checks.

## Verification

- Commands to run: `git diff --check`; focused CLI release policy coverage test;
  targeted stale-reference searches and final diff readback.
- Expected outcomes: all commands pass and the final diff contains no private
  identifiers or unrelated changes.
