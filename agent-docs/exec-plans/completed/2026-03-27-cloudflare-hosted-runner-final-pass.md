# Cloudflare Hosted Runner Final Pass

Status: completed
Created: 2026-03-27
Updated: 2026-03-28

## Goal

Integrate the final hosted-runner follow-up for encrypted per-user runner env overrides, shared worker/runner allowlist extensions, broader runner/container presets, and persistence coverage without changing the local-first architecture.

## Scope

- Add operator control routes for per-user hosted runner env status/update/clear.
- Persist encrypted per-user env overrides inside the hosted `agent-state` bundle at `.murph/hosted/user-env.json`.
- Load per-user env overrides only for the duration of a hosted one-shot runner execution, then restore the previous process environment.
- Keep worker and runner allowlist extension env vars aligned.
- Tighten the runner image/env examples/docs and add a hosted persistence test for per-user env survival across a real run.

## Constraints

- Keep the current Worker plus Durable Object plus separate Node runner split; do not rewrite to native Cloudflare Containers bindings in this pass.
- Preserve the local-first vault/agent-state model; hosted env overrides belong only in the encrypted `agent-state` bundle, never in plaintext DO state.
- Keep control routes internal/operator-only and never return secret env values, only safe status metadata such as configured key names.
- Preserve adjacent dirty work and avoid broad runtime or deploy automation inventions beyond truthful scaffold docs.

## Risks

1. Per-user env handling can leak secrets through logs or responses.
   Mitigation: validate against a strict allowlist, store only in encrypted bundles, and expose only configured key names from status routes/tests.
2. Process-env overrides can bleed between hosted runs.
   Mitigation: snapshot and restore every changed env key around each one-shot execution.
3. Bundle persistence can accidentally drop or over-include hosted state.
   Mitigation: keep the persisted path explicit and extend hosted-bundle tests at the runtime-state boundary.

## Verification Plan

- Focused `apps/cloudflare` tests/typecheck.
- Focused `packages/runtime-state` tests if the bundle helper coverage changes materially.
- Required repo commands after integration: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Completion workflow audit passes via spawned subagents for simplify, coverage, and finish review.

## Outcome

- Added encrypted per-user hosted runner env storage and operator control routes without changing the Worker plus Durable Object plus separate runner architecture.
- Kept shared allowlist extension vars aligned between worker and runner read/write paths, including extension-key round-tripping through persisted bundle reads.
- Added focused regression coverage for bundle text patching, env route forwarding, extension-key status/update reads, and process-env restoration after one-shot runs.
- `pnpm typecheck` and `pnpm test` passed during the final pass.
- `pnpm test:coverage` is currently blocked outside this lane by unrelated red tests in `packages/cli/test/search-runtime.test.ts` plus a standalone `@murph/core` `initializeVault()` metadata validation failure caused by the active worktree state (`$.idPolicy.prefixes: Unrecognized key: "workoutFormat"`).
Completed: 2026-03-28
