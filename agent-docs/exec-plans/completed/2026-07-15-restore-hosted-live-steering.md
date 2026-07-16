# Restore Hosted Live Steering

## Goal

Restore the established hosted behavior where a compatible follow-up message
that arrives while Codex is still running is folded into that live provider
turn, without adding an input debounce or post-completion reply hold.

## User Experience

- Murph starts the first reply immediately.
- A same-participant, exact-successor follow-up received while the Codex turn is
  live is steered into that turn.
- Murph produces one final response when the follow-up arrives before a final
  response segment exists.
- A different group participant, causal gap, native reply-anchor change, or
  completed provider turn remains a normal later turn.

## Constraints

- Do not restore the unsafe pre-PR-639 path that let a late input trigger an
  irreversible effect before it owned stable accepted-input/effect identity.
- Reuse the existing causal compatibility selector and generic Codex
  `turn/steer` lifecycle.
- Keep foreground global pending-index refresh off the provider-start path.
- Add no debounce, reply timer, scheduler, queue, or post-completion draft
  supersession state.
- Preserve foreign-actor ordering in groups and native reply-anchor boundaries.
- Keep ordinary non-steered private and group reply latency unchanged.

## Plan

1. Trace the exact staged-input notification, active-turn admission, accepted
   input, effect-authority, finalization, and recovery boundaries on current
   `main` and select the smallest crash-safe ownership seam.
2. Restore exact late-input admission only for the oldest compatible causal
   successor while preserving foreground selection isolation.
3. Bind steered-input membership and effect authority to the existing turn and
   provider delivery-context lifecycle before any irreversible effect or final
   delivery can escape.
4. Add focused engine/runtime regressions plus a production-faithful hosted
   scenario covering successful steering, group actor barriers, completion
   races, and crash/retry identity.
5. Update the durable hosted runtime contract to remove the current
   contradiction and describe the restored live-steering boundary.
6. Run scoped coverage, the required coverage audit, parent final review,
   commit/PR workflow, ReviewGPT, and CI.

## Verification

- Full serial assistant-engine suite: 154 files passed (1 skipped), 2,235 tests
  passed (4 skipped).
- Full serial assistant-runtime suite: 74 files and 1,689 tests passed (2
  skipped).
- Final focused assistant-engine proof: 7 files and 346 tests passed.
- Final focused hosted turn-input proof: 23 tests passed; the changed runtime
  source measured 95.45% line coverage in the focused coverage run.
- A production-path local-service scenario proves the exact staged ID is
  steered into one provider turn and committed to the journal/provider-request
  prefix before a hosted tool effect.
- Assistant engine, runtime, CLI, daemon, and setup-CLI reverse-dependent tests
  and typechecks passed. The repository-wide coverage wrapper remains locally
  blocked by an unrelated V8 worker OOM/CLI harness timeout; ordinary full owner
  suites are green.
- The required coverage-write audit found no missing behavioral proof and made
  no edits.
- `git diff --check` and the identifier privacy scan passed.

## State

Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
