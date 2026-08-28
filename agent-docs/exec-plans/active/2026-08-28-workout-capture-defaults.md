# Apply saved workout capture defaults

Status: active
Created: 2026-08-28
Updated: 2026-08-28

## Goal

Make an explicit member preference for the default duration of subsequently
reported workouts apply at the canonical workout write boundary, even when a
later model turn does not independently recall freeform memory.

## Product UX Plan

Effort: Product change.

- Outcome: a member sets one workout-duration default once, then reports later
  workouts naturally without being asked for that duration again.
- Entry and promise: in a private conversation, an explicit ongoing default is
  saved immediately; later `workout add` writes use an explicit duration when
  supplied, otherwise the saved default.
- Affected people: an established member with a typed default, a member whose
  explicit default still exists only in legacy freeform memory, a member who
  states a different duration for one workout, and a member with no default.
- Recovery: clearing the default restores the existing explicit-duration
  requirement; malformed or unavailable preferences fail without inventing a
  duration.
- Deliberate exclusions: imports and live tracked workouts keep their existing
  timing owners; no default is inferred from history, past workouts, or
  conflicting memory. One exact legacy memory preference can be migrated.
- Proof: focused command and persistence tests, a deterministic composed-prompt
  regression, deterministic legacy migration coverage, and one
  production-derived real-Codex journey for a fresh typed default.

## Architecture

- Keep the value in the existing canonical `bank/preferences.json` document.
- Add one workout-capture preference owner beside the existing workout-unit
  preference owner. On a missing-duration write, a narrow compatibility path
  can recognize one explicit legacy preference, reject ambiguity or conflicts,
  and atomically promote it into typed state only when the typed value is unset.
- Resolve duration in this order: explicit command/payload evidence, the saved
  typed capture default, then one eligible legacy value promoted into typed
  state. The write receipt remains authoritative.
- Teach Murph to use the typed preference command for new explicit ongoing
  workout defaults, not duplicate the fact into freeform memory, and try the
  canonical workout write before asking for a missing duration.

## Tasks

1. Add the typed preference schema, core read/write owner, CLI use case, and
   `workout defaults show|set` surface with clear support.
2. Apply the saved duration only to ordinary member-reported `workout add`
   capture when the message and flags omit duration.
3. Add deterministic command, schema, persistence, precedence, clearing, and
   assistant-instruction regressions.
4. Add and run one focused real-Codex journey, then complete the required
   Product UX and ReviewGPT gates.

## Verification

- Product UX walkthrough:
  - Fresh default: the real-Codex journey saved 60 minutes, then a fresh later
    yoga report produced one 60-minute workout write with no duration question.
  - Current-report precedence: focused CLI proof covered text and flag
    overrides, while ambiguous duration still failed closed.
  - Established member: focused CLI proof rejected conflicting legacy
    preferences, promoted agreeing explicit legacy preferences, and persisted
    the promoted duration in the typed owner.
  - Recovery/no default: clearing remained authoritative after migration;
    ordinary missing-duration capture without an applicable default still
    returned the established explicit-duration error.
  - Verdict: Ready. The tested entry, feedback, precedence, recovery, and
    legacy paths match the product promise without changing import semantics.
- Deterministic proof:
  - contracts preferences/public-entrypoint/generated-schema tests: 26 passed.
  - core workout-capture preference test: 1 passed.
  - CLI workout-capture focused tests: 3 passed.
  - assistant composed-prompt regression: 1 passed.
  - relevant contracts, core, operator-config, vault-usecases, CLI, and
    assistant-engine typechecks passed.
- Real assistant proof:
  - `pnpm test:assistant:live -- --test "applies a saved workout duration default on a fresh later report"`: 1 passed; actual reply confirmed one logged 60-minute yoga workout and no duration question.
