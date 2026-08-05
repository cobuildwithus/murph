# Shorten the hosted idle checkpoint floor to 90 seconds

Status: active
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Reduce billed dirty-runtime tail time after a reply from three minutes to 90
  seconds without coupling checkpoint durability to the independent warm
  container lease.
- Preserve foreground-input priority: a user message cancels an interruptible
  checkpoint attempt and resumes the active runtime instead of waiting behind
  snapshot work.

## Constraints

- Keep one shared runtime-control limit; do not add an adaptive timer, lifecycle
  manager, queue, or persisted state.
- Keep the 20-minute warm-container lease and its one-minute reevaluation cadence
  unchanged.
- Keep final snapshot publication and write-fence release ordering unchanged.

## Tasks

1. Export one 90-second default/minimum from the hosted-execution owner package
   and reuse it in assistant-runtime and Cloudflare configuration.
2. Update focused unit coverage for defaulting, production validation,
   checkpoint publication, and foreground cancellation behavior.
3. Update the runtime contract, deploy guidance, and verification map to state
   that checkpoint quiet time and warm-container retention are independent.
4. Run focused tests, typechecks, docs drift, exact-head ReviewGPT passes, and
   required PR CI; resolve accepted findings before completion.

## Verification log

- Focused hosted-execution tests passed: 2 files, 41 tests.
- Focused assistant-runtime checkpoint tests passed: 2 files, 27 tests.
- Focused Cloudflare environment tests passed: 1 file, 25 tests.
- Hosted-execution, assistant-runtime, and Cloudflare package typechecks passed.
- `pnpm docs:drift` and `git diff --check` passed.
- Production-shaped runner bundle assembly is blocked before scenario execution
  by the existing runner entrypoint/static-closure byte budgets (about 38 KB and
  33 KB over respectively); the largest reported inputs are unrelated runtime
  modules, and this change keeps the limit in its own tiny import subpath.
- Exact-head ReviewGPT and CI are pending.
