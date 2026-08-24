# Vault CLI Error Foundation Remediation

Status: completed
Created: 2026-08-24

## Goal

Make setup and main Vault CLI failures use one privacy-safe projection, teach
the assistant how to act on that envelope exactly once, and prove the same rich
fields survive direct Incur fetch transport.

## Root Cause

- Setup CLI retains an older local bridge that drops safe repair fields and
  leaves ordinary filesystem errors to Incur's generic fallback.
- The assistant prompt does not define the recovery semantics of `fieldErrors`,
  `hint`, `stage`, and `retryable`.
- Existing rich-envelope proof covers `serve()` but not direct `Cli.fetch()`.
- The completed foundation plan overstates domain issue population: the shared
  projection is safe, while individual domain owners still must opt into
  value-free repair details.

## Architecture

- Move the existing pure projection to its own lazily loadable
  `@murphai/operator-config` entrypoint, the lowest current owner shared by
  setup and main CLI, without growing the CLI static startup closure.
- Keep native Incur parse and validation errors unchanged; both bridges project
  only non-Incur failures through the shared function.
- Keep domain repair explicit at each domain owner. Do not inspect generic
  validation context, add a service, or create another error hierarchy.
- Leave Mapbox unchanged because its separate PR owns that surface.

## Product UX Patch

- Outcome: Murph can correct a failed CLI call or stop safely without guessing
  from omitted details.
- Reaches: existing direct and hosted assistant turns using setup or main CLI.
- Proof: prompt assembly contains one recovery rule; setup, main serve, and
  direct fetch tests retain rich safe fields and never echo raw values or paths.

## Verification

- Focused operator-config, setup-cli, assistant-engine, and CLI tests.
- Focused package typechecks and CLI package-shape/bundle proof as applicable.
- Final diff, privacy scan, Product UX walkthrough, and scoped finish-task
  commit without pushing or changing PR metadata.

## Progress

- Accepted preliminary findings and exact PR head were supplied by the parent.
- Worktree ownership, clean state, and Frog inventory were verified.
- Moved the pure privacy-safe projection to a dedicated operator-config
  entrypoint and reused it from setup, main CLI middleware, and lazy pre-serve
  entrypoint rendering.
- Added the assistant recovery rule once at the CLI-guidance layer and direct
  `Cli.fetch()` rich-envelope acceptance coverage.
- Kept the contract truthful: this change establishes the transport seam;
  value-free field repair remains incrementally populated by domain owners.
  No shared issue helper was added because this remediation introduced no
  duplicated domain issue mapping to collapse.
- Verified setup and main bridges preserve native Incur parse/validation
  errors; the shared projector handles explicit repair data and bounded
  filesystem categories without reading generic validation context.
- Focused tests passed: operator-config (19), setup-cli (33), assistant-engine
  (15), and CLI bridge/entrypoint (91). All four affected package typechecks,
  CLI package-shape verification, workspace-boundary verification, and the
  production runner bundle/parity budget passed.
- Product UX replay passed for rich correctable errors, non-retryable corrected
  or prerequisite-resolved calls, unchanged retryable calls, native argument
  failures, and secret-safe filesystem failures.
Updated: 2026-08-24
Completed: 2026-08-24
