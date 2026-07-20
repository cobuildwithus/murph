# PR 769 proactive permission offer

## Goal

Teach Murph to give the available standings, name each participant whose data
is unavailable, and proactively open the existing Like-or-heart permission
offer when the exact group share is `not_granted` and that participant has not
declined sharing it.

The offer remains a model-decided tool call inside the already-started
scheduled turn. It is not a generic server message, scheduler side effect, or
pre-model operation.

## Invariants

- Standings distinguish missing consent from missing or stale synced data.
- Only an exact `not_granted` result may lead to a permission offer; reconnect,
  disconnected, stale-sync, and missing-data cases receive ordinary-language
  recovery guidance instead.
- Murph does not offer, retry, or nag after an explicit sharing decline and
  records that choice in the challenge page rather than adding new state.
- Web continues to own the canonical consent copy, frozen scope disclosure,
  recipient targeting, active-offer dedupe, and Like-or-heart acceptance.
- Shared diagnostics and any permission offer remain lazy model tool calls
  after provider start, preserving current-turn latency.
- Add no dependency, persisted state, queue, retry process, compatibility
  layer, or second delivery owner.

## Work plan

1. Restore the smallest scheduled-turn tool surface needed for the model to
   open the existing permission offer after an evidence-bearing shared read.
2. Update system and challenge instructions with the proactive behavior,
   explicit-decline guard, and permission-versus-sync distinction.
3. Align the durable product spec and focused tests with the approved second
   message while preserving the automatic-message invariant.
4. Run focused verification, required completion audits, commit, push, and run
   ReviewGPT with CI against the exact new PR head.

## Verification

- `pnpm typecheck` in `packages/assistant-engine`: passed.
- `pnpm typecheck` in `packages/assistant-runtime`: passed.
- Assistant Engine focused owner suite with an 8 GB Node heap: 537 passed.
- Assistant Runtime full suite: 1,737 passed, 2 skipped.
- Assistant Runtime hosted phase regression file: 235 passed.
- Prompt size bound: 1 passed, 70 skipped.
- `coverage-write`: added granted-plus-missing supersession coverage and
  aligned prompt assertions; zero remaining findings.
- `prompt-review`: corrected scheduled-prompt coverage, the interactive
  `read_current` conflict, scoring-versus-diagnostic ambiguity, and per-scope
  decline/offer eligibility; zero remaining findings.
- `pnpm test:diff packages/assistant-engine packages/assistant-runtime
  agent-docs/product-specs/group-challenge-data-diagnostics.md`: global guards,
  six affected typechecks, Assistant Runtime (1,737 passed, 2 skipped),
  Assistant CLI (128 passed), Assistantd (40 passed), and Setup CLI (124
  passed) completed. The aggregate Assistant Engine worker hit the known 4 GB
  heap ceiling after 2,521 passing tests; its changed surface passed 537/537 in
  the focused 8 GB lane. The unrelated CLI release audit also failed its local
  ReviewGPT model-picker proof; 36 other tests in that file passed and 1 was
  skipped.

Status: completed
Updated: 2026-07-19
Completed: 2026-07-19
