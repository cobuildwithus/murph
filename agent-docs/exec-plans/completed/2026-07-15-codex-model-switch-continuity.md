# Preserve Codex Thread Continuity Across Model Changes

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

Align Murph's next-turn model and reasoning changes with Codex's native
`/model` behavior: keep the existing Codex thread, apply the new settings before
the next accepted input, and let Codex adapt its retained history.

## Success criteria

- A model-only or reasoning-only change keeps the same Murph session and native
  Codex thread when the rest of the runtime and assistant contract is unchanged.
- The next `turn/start` carries the effective model and reasoning effort so a
  warm already-loaded thread receives the settings atomically with the new
  input.
- Codex remains responsible for model-switch instructions, history adaptation,
  and compaction.
- Provider, Codex home/command, sandbox, approval, profile, OSS, prompt, or tool
  contract changes still reject incompatible native resume state.
- Existing resume records migrate safely without a fleet-wide fresh-thread cut.
- Idle compaction retains truthful attribution to the model actually bound to
  the warm thread without retiring a still-useful thread.

## Scope

- Codex target/session continuity fingerprints and resume bindings.
- Codex App Server `turn/start` request shaping.
- Hosted same-invocation target projection and idle compaction attribution.
- Focused operator-config, assistant-engine, assistant-runtime tests and current
  durable architecture/product documentation.

## Constraints

- Keep Web/Postgres as the durable owner of hosted model intent.
- Do not change a provider turn already in flight.
- Use Codex's native thread-settings machinery instead of replaying or
  supervising model context in Murph.
- Preserve unrelated work in the shared checkout and other active worktrees.

## Verification

- Focused tests for stable continuity, incompatible target rejection, legacy
  resume migration, request shape, real scripted same-thread model switching,
  and idle compaction attribution.
- Truthful `pnpm test:diff` for every touched owner.
- Required `coverage-write` audit, parent final review, PR CI, and a new
  substantive ReviewGPT round on the pushed production-code head.

Completed local proof:

- Operator-config continuity coverage passed (5 tests).
- Assistant-engine continuity, planning, session, notification, and Codex
  runtime coverage passed, including the real scripted two-model scenario on
  one native thread (13 scripted tests; 2,238 full-suite tests with 5 skipped).
- Assistant-runtime idle-maintenance coverage passed (1,694 tests with 2
  skipped), including actual bound-model attribution and unpriced-model skip.
- CLI Codex request-shape coverage passed (9 focused tests).
- Operator-config, assistant-engine, and assistant-runtime typechecks passed.
- The required coverage-write audit added execution-boundary and unproved
  legacy-binding regression proof; its focused seam suite passed (13 tests).
- `git diff --check` passed.
- Diff-aware verification reached the CLI suite after all affected owner
  typechecks and the assistant-engine/runtime suites passed. Its sole failure
  was the pre-existing generated CLI skill-hash expectation, outside this
  change's command-registration and generated-file scope.

## Deployment

The persisted resume shape change must be additive. Existing exact-route
bindings remain valid and acquire the new compatibility fingerprint only after
their stored target proves the legacy binding. Old runner bundles continue to
start a fresh native thread on target changes; new bundles preserve it.
Completed: 2026-07-15
