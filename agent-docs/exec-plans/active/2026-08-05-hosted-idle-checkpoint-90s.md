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

1. Reuse one 90-second default/minimum from the hosted-execution owner package
   in assistant-runtime and Cloudflare configuration.
2. Preserve explicit 180-second and 90-second rollout values through the
   existing generated Worker-variable path.
3. Cover defaulting, production validation, owner-recheck composition,
   checkpoint publication, cleanup scheduling, and deploy rendering.
4. Update the runtime contract and deploy guidance, then complete exact-head
   ReviewGPT, CI, parent review, and plan closure.

## Verification log

- Focused hosted-execution tests passed before final review: 2 files, 41 tests.
- Focused assistant-runtime checkpoint tests passed before final review: 2
  files, 27 tests.
- Focused Cloudflare environment tests and affected package typechecks passed
  before final review.
- Final ReviewGPT accepted one deploy-owner finding: the rollout variable was
  absent from the existing optional Worker-variable allowlist. The correction
  reuses that allowlist and adds focused generated-config proof.
- Production-shaped local scenario assembly remains blocked before execution by
  the existing runner entrypoint/static-closure byte budgets; exact-head CI owns
  the scenario proof.
- Corrected-head Cloudflare environment/deploy tests passed: 2 files, 53 tests.
- Corrected-head hosted-execution tests passed: 2 files, 41 tests.
- Corrected-head assistant-runtime tests passed: 2 files, 27 tests.
- Corrected-head Cloudflare typecheck, docs drift, and diff check passed.
- ReviewGPT correction verification and exact-head CI are pending.
