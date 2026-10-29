# Meal failure origin telemetry

Status: completed
Created: 2026-10-24
Updated: 2026-10-24

## Outcome

Implementation verification is complete. The existing original-error CLI timing
observer and finite `sourceCause` selector distinguish source-owned meal edit and
photo-removal failures while preserving behavior and legacy accounting. Partial
historical observations motivated the probe; they do not establish a production
cause or prompt defect.

Production assistant prompts, tool contracts and schemas, CLI handlers, outputs
and recovery are unchanged. No stochastic assistant journey is required for this
optional telemetry change. No new store, dependency, retry or awaited work was
introduced. Fixtures are synthetic; tracked evidence contains no member data or
direct identifiers.

## Contract and decisions

- Reuse `sourceCause: { code, vaultCode? }` and existing variant equality. Admit
  only command-gated, source-owned literals for contract, lock, ambiguous-ledger
  and photo-retention/reference causes.
- `missing_code` describes no safely observed own code; `unrecognized_code`
  describes an observed value outside the recognized catalogs. Neither guesses
  an exception kind or backfills absent legacy evidence.
- Observe safe own data without invoking getters or traversing causes. Node owns
  native proxy rejection; the portable wire reader remains Node-independent.
  Arbitrary codes, messages, stacks, context, arguments, paths, identifiers,
  payloads and results are never retained.
- Preserve outer code/stage/count, optionality, the eight-variant budget, explicit
  drops and whole-command UDP trimming. Old readers discard new detail while
  preserving timing/accounting; new readers preserve legacy absence.

## Verification complete

Parent executed the following on Node 24.22.1 with locked dependencies:

- The actual real-meal CLI/core/usecase fixture passed on unchanged base
  `5a7bebcdafafbf7e8d204d881eeca9a8b114b552` with
  `MURPH_CLI_MEAL_ORIGIN_BASELINE`, and on the candidate. Lock versus ambiguous
  ledger and invalid JSON versus invalid contract, each for edit and remove-photo,
  give four alternative pairs that collide before and distinguish after. Original
  error identity, outputs/exits, calls, writes and canonical bytes are unchanged.
- Full real CLI timing and subprocess files: 55/55 passed before final test-only
  changes; final focused real-meal collision: 1 passed, 15 unrelated tests skipped.
- Runtime-state timing: 67 passed, 18 unrelated historical gates skipped, with
  `MURPH_CLI_SOURCE_CAUSE_COMPAT_BASE=704630e3fda169456458db4c7a0f50121be120ee`.
- Assistant-engine profile and transport: 22 passed, 8 unrelated historical gates
  skipped, with that original compatibility base and
  `MURPH_CLI_MEAL_ORIGIN_COMPAT_BASE=5a7bebcdafafbf7e8d204d881eeca9a8b114b552`.
  The actual preceding normalizer, hosted parser and both profile versions were
  exercised, including bounded optional detail and unchanged accounting/privacy.
- Runtime-state, assistant-engine and CLI package typechecks all pass.
- Complexity passes with no hotspots above 20; `docs:drift` and workspace-boundary
  checks pass.

## Handoff and remaining gates

Parent will inspect and close only this implementation plan as a handoff through
`scripts/finish-task`. Independent fresh ReviewGPT review and exact-head CI remain
pending. Release still requires the exclusive reviewed revision and supported
protected deployment path.

Release is held because native same-chat heartbeat scheduling is not exposed and
native app UI access is explicitly denied. No deployment or monitoring has
started. The same user task retains release and four-hour monitoring follow-through
when capability becomes available; parent must preserve the active PR worktree
while blocked.
Completed: 2026-10-24
