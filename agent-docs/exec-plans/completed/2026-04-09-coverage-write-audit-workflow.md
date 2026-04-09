# Coverage-Write Audit Workflow Plan

## Goal

Add an optional workflow pass that uses a mini write-capable subagent to author missing tests for a finished implementation after any simplify pass and in parallel with the final completion audit.

## Scope

- Update the completion workflow to define when and how the optional coverage-writing pass runs.
- Add a dedicated prompt for the mini write-capable coverage worker.
- Align the final completion-review prompt so it still owns remaining proof review when the optional writer runs.
- Keep the final completion audit responsible for remaining proof review after any worker-authored tests land.

## Constraints

- Keep this change limited to Markdown docs/process files.
- Do not weaken the existing final completion review or simplify rules.
- Make the coverage-writing pass explicitly opt-in or user-requested rather than a new default audit requirement.

## Verification

- Markdown readback only (text-only docs/process fast path).

## Outcome

- Added an optional write-capable coverage/proof pass to the completion workflow that runs after simplify (if any) and in parallel with the final completion audit when the user explicitly asks for it.
- Added `agent-docs/prompts/coverage-write.md` for the narrow `gpt-5.4-mini` worker that writes tests or proof scaffolding only.
- Updated the final completion-review prompt so it still owns remaining proof review when the optional writer runs in parallel.

Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
Completed: 2026-04-09
