# Hosted Runner Boundary Hardening

## Goal

Fix the reported hosted runner containment, identity, token lifetime, cleanup, env-sanitization, local-proxy, and lifecycle-config parsing gaps without widening into unrelated hosted run, Linq, assistant-provider, or user-facing web work.

Success criteria:

- The runner supervisor process does not carry operator secrets or runner control tokens in child-readable process environment.
- Container routing identity and job `runDrain.userId` are asserted equal before execution, and outbound proxy state is bound to the active `{ userId, runId, attempt }`.
- Outbound proxy tokens are minted per run and expired after run completion.
- Container descendant cleanup runs in a `finally` path for both successful and failed parsed jobs.
- `runtime.userEnv`, `runtime.forwardedEnv`, and child env handling fail closed on process-control, platform, local-proxy, and hosted execution control keys at the final seam.
- Local internal proxy base URL is supervisor-only and cannot be supplied through forwarded child env or ambient child process env.
- Runner lifecycle timeout env parsing is strict.
- Focused tests cover the reported regressions, including `/proc/${process.ppid}/environ` leakage where supported.

## Scope

Primary files:

- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/src/hosted-env-policy.ts`
- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/src/node-runner-child.ts`
- `apps/cloudflare/src/node-runner-isolated.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/runner-env.ts`
- `apps/cloudflare/src/runner-secrets.ts`
- `apps/cloudflare/src/runtime-platform.ts`
- `packages/assistant-runtime/src/hosted-runtime/environment.ts`

Directly coupled focused tests:

- `apps/cloudflare/test/runner-container.test.ts`
- `apps/cloudflare/test/runner-env.test.ts`
- `apps/cloudflare/test/node-runner-isolated.test.ts`
- `apps/cloudflare/test/node-runner.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-environment.test.ts`

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Coordinate with the active Linq webhook secret boundary row where it overlaps `hosted-runtime/environment.ts`, `hosted-env-policy.ts`, and runner env tests.
- Do not introduce new npm dependencies.
- Do not invent Cloudflare deployment requirements beyond the existing container runner model.

## Plan

1. Inspect the current runner/container/env control flow and focused tests.
2. Add or centralize final-seam env sanitization, including local-proxy stripping and user-env allowlist enforcement.
3. Remove supervisor secrets/control token from long-lived shell environment and pass required authority through in-memory process state only.
4. Bind container routing identity and outbound proxy tokens to the active run identity, with cleanup/expiry after completion.
5. Move descendant process sweep to parsed-job `finally` and gate `keepWarm` on successful cleanup.
6. Add strict positive-integer lifecycle env parsing.
7. Add focused tests and direct scenario proof.
8. Run required verification and audit passes, then close the plan through the repo workflow.

## Progress

- 2026-04-24: Plan opened and ledger row registered.
- 2026-04-24: Implemented supervisor env scrub, request-header runner control token initialization, job/user identity assertions, per-run outbound proxy state with expiry, failed-job process cleanup, final-seam env filtering, local-proxy base stripping/binding, and strict lifecycle/commit-timeout env parsing.
- 2026-04-24: Focused tests passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/node-runner-isolated.test.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/runner-platform.test.ts`; `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-environment.test.ts`.
- 2026-04-24: Package typechecks attempted and blocked by unrelated concurrent `packages/assistant-runtime/src/hosted-runtime/context.ts` managed-auto-reply typing drift and coupled context tests.
- 2026-04-24: Required `simplify` audit completed. Applied its in-scope duplicate runner-secret filtering cleanup; deferred cross-package managed-auto-reply default extraction because it overlaps active assistant-runtime context typing work.
- 2026-04-24: Required `coverage-write` audit reran focused Cloudflare and assistant-runtime env proof, found no missing proof, and made no edits.
- 2026-04-24: Required `task-finish-review` audit found no findings. Added its suggested focused negative test for `run.runId !== runDrain.runId`.
- 2026-04-24: Final focused proof passed after review follow-up: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/node-runner-isolated.test.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/runner-platform.test.ts && pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-environment.test.ts` (157 Cloudflare tests, 10 assistant-runtime tests).
- 2026-04-24: `pnpm verify:acceptance` attempted and blocked at workspace package typecheck by unrelated concurrent `packages/assistant-runtime/src/hosted-runtime/context.ts` managed-auto-reply typing drift.
Status: completed
Updated: 2026-04-24
Completed: 2026-04-24
