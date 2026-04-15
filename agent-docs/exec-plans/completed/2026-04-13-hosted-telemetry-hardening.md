# Hosted telemetry hardening for Cloudflare runner failures

Status: completed
Created: 2026-04-13
Updated: 2026-04-13

## Goal

- Make hosted Cloudflare runner failures materially easier to debug without leaking secrets, credentials, or user-identifying payloads.
- Preserve the existing hosted trust boundary while surfacing redacted inner failure causes, clearer run phases, and capability/readiness telemetry.

## Success criteria

- The runner/container/runtime path emits enough structured telemetry to distinguish startup, request decode, runtime execution, durable commit, finalize, and post-commit side-effect failures.
- Non-sensitive inner runtime failures propagate back through the container boundary as safe error payloads instead of only generic `runtime_error`.
- Logs include redacted runtime capability snapshots and explicit phase transitions without exposing secrets, raw env values, or direct personal identifiers.
- Expected probe misses and similar low-signal events are clearly separated from actionable failures.
- Focused tests cover the new telemetry behavior and redaction rules.
- Required verification passes.

## Scope

- In scope:
  - `apps/cloudflare/**` hosted runner, container entrypoint, outbound surfaces, and worker observability changes.
  - `packages/assistant-runtime/**` hosted runtime telemetry and safe failure propagation.
  - `packages/hosted-execution/**` shared observability helpers needed for redacted diagnostics.
  - Focused tests and any durable docs touched by the new runtime behavior.
- Out of scope:
  - Broad hosted assistant product changes unrelated to diagnostics.
  - Lowering existing redaction standards to gain visibility.
  - New external telemetry vendors or third-party observability infrastructure.

## Constraints

- Never log raw secrets, raw env values, bearer tokens, API keys, or direct PII.
- Keep operator-facing failure messages concise and redactable while still preserving enough detail for debugging.
- Preserve existing retry and error-code semantics unless the richer telemetry needs a compatible extension.
- Preserve unrelated worktree edits.

## Risks and mitigations

1. Risk: More logs accidentally expose secrets or user data.
   Mitigation: Centralize redaction in shared observability helpers, log booleans/capabilities instead of values, and add tests for sanitization.

2. Risk: The container/runtime boundary still flattens useful failure context.
   Mitigation: Propagate a safe error envelope for non-sensitive runtime failures and log the richer context on both sides of the boundary.

3. Risk: Additional telemetry obscures the real signal with noisy expected misses.
   Mitigation: Distinguish informational probe misses from actionable failures and avoid upgrading known-expected object misses into errors.

## Tasks

1. Harden shared observability utilities for richer redacted diagnostics.
2. Add phase and capability telemetry to the worker, container entrypoint, and hosted runtime.
3. Surface safe inner runtime errors through the container response boundary.
4. Add or update focused tests for error propagation, redaction, and telemetry shape.
5. Run required verification and audit passes.

## Decisions

- Centralize telemetry redaction and safe detail shaping inside `packages/hosted-execution/src/observability.ts` so runner, container, and runtime logs all share one redaction policy.
- Surface safe runtime/container failures back through the container HTTP boundary with explicit `code`, `error`, optional `errorName`, and redacted `details` instead of a dead-end opaque payload.
- Log runtime and runner capability snapshots as booleans, counts, and env-key names only; never log env values.
- Keep readiness telemetry on the Cloudflare container boundary by recording warm/cold startup mode and readiness latency.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff apps/cloudflare packages/assistant-runtime packages/hosted-execution`
- Expected outcomes:
  - Typecheck passes.
  - Diff-aware coverage for the touched owners passes with the new telemetry behavior.

## Outcomes

- Implemented richer redacted telemetry across:
  - `apps/cloudflare/src/container-entrypoint.ts`
  - `apps/cloudflare/src/runner-container.ts`
  - `apps/cloudflare/src/user-runner/runner-dispatch-processor.ts`
  - `packages/assistant-runtime/src/hosted-runtime.ts`
  - `packages/hosted-execution/src/observability.ts`
- Added or updated focused tests under:
  - `apps/cloudflare/test/**`
  - `packages/assistant-runtime/test/**`
  - `packages/hosted-execution/test/**`
- Verification completed:
  - `pnpm --filter @murphai/hosted-execution typecheck` ✅
  - `pnpm --filter @murphai/assistant-runtime typecheck` ✅
  - `pnpm --filter @murphai/cloudflare-runner typecheck` ✅
  - `pnpm exec vitest run --reporter=dot packages/hosted-execution/test/hosted-execution-observability-side-effects.test.ts packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts packages/assistant-runtime/test/hosted-runtime-runner.test.ts` ✅
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --reporter=dot apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/dispatch-payload-store.test.ts apps/cloudflare/test/user-runner.test.ts` ✅
- Full-repo verification blockers observed:
  - `pnpm typecheck` ❌ pre-existing unrelated syntax errors in `packages/assistant-engine/src/model-harness.ts`
  - `bash scripts/workspace-verify.sh test:diff ...` ❌ diff-owner expansion hit pre-existing unrelated type errors in `packages/cli/test/assistant-harness.test.ts`
Completed: 2026-04-13
