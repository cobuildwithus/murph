# Correlate container startup timeout stages

Status: completed
Created: 2026-09-04

## Goal

- Make an exact runtime-processing timeout attributable to the existing
  container-local startup stage without adding a request, timer, retry, state
  owner, or user-visible delay.
- Keep the diagnostic metadata-only and preserve every readiness, cleanup, and
  write-fence behavior.

## Evidence

- UserRunner already records the orchestration attempt, caller deadline, retry
  reason, and elapsed time when its readiness RPC times out.
- RunnerContainer already records the local failure stage and elapsed time, but
  intentionally omits correlation metadata, so the two records cannot be joined
  for one exact failed attempt.
- The readiness RPC already receives a metadata-only request from UserRunner;
  the existing orchestration attempt identifier is already logged at the
  caller boundary.

## Scope

- Add the existing orchestration attempt identifier as optional metadata on the
  internal readiness RPC and the existing failure-only container log.
- Record the effective readiness timeout on both failure boundaries.
- Add focused correlation, compatibility, and privacy regressions and align the
  hosted runtime protocol documentation.

## Protected invariants

- No raw user, workspace, message, provider, prompt, payload, credential, URL,
  path, environment value, or error text enters the new fields.
- Old callers remain valid when the optional correlation field is absent, and
  old callees continue ignoring the additive field during rollout skew.
- The foreground reply path gains no awaited work, network call, retry, or
  persistence.
- Cloudflare remains the container-startup diagnostic owner; Temporal remains
  pointer-only and owns durable retry/coalescing.

## Tasks

1. [x] Implement the additive internal correlation metadata in the existing
   readiness request and failure logger.
2. [x] Add focused tests for exact-attempt correlation, timeout values, absent-field
   compatibility, and identifier exclusion.
3. [x] Update the durable runtime protocol and run focused tests, typecheck,
   complexity, diff, and privacy checks.
4. [x] Prepare the scoped candidate and archive this implementation plan.

PR creation, exact-head CI, and the final ReviewGPT gate follow the repository's
external completion workflow after this plan is archived.

## Verification

- Passed twice: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/user-runner-alarm.test.ts --no-coverage` (395 tests).
- Passed: `pnpm --dir apps/cloudflare typecheck`.
- Passed: `pnpm complexity:diff`; both touched-source hotspot totals are
  unchanged and the patch adds no branch to either listed hotspot.
- Passed: `pnpm docs:drift`, `pnpm docs:gardening`, `git diff --check`, and the
  task-diff direct-identifier scan.
- The root typecheck dispatcher was not used as duplicate proof: it was waiting
  behind an independently owned acceptance run, while the directly relevant
  Cloudflare typecheck completed successfully.

## Deployment concerns

- This is additive diagnostic metadata inside one Worker deployment and is
  independently reversible. No schema or state migration exists.
- Deploy through the protected Cloudflare workflow only after exact-head review
  and CI. Confirm one natural timeout or bounded synthetic smoke correlates the
  caller deadline with a container-local stage before relying on the field.
Updated: 2026-09-04
Completed: 2026-09-04
