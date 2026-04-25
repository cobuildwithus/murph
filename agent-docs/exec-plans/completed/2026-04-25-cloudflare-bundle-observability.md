# Cloudflare Bundle Observability

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

Improve hosted Cloudflare runtime observability so invalid hosted bundle archives produce actionable structured error codes/details instead of collapsing into generic `runtime_error` / alarm timestamp noise, and fix the runner container image Tini subreaper warning.

## Success Criteria

- Hosted bundle validation failures map to a dedicated safe error code/name.
- Cloudflare runner logs include privacy-bounded bundle validation metadata useful for correlating failed hosted-run retries.
- The hosted runner Dockerfile starts Tini in subreaper mode.
- Focused tests cover the new observability contract and image contract.
- Required verification and completion audit passes run before handoff.

## Scope

- `packages/hosted-execution` observability error-code mapping and tests.
- `apps/cloudflare` runner/container/bundle validation logs and directly coupled tests.
- `Dockerfile.cloudflare-hosted-runner` plus its image contract test.

## Constraints

- Do not log secrets, raw user identifiers, raw bundle contents, local paths, or contact identifiers.
- Keep bundle metadata bounded to safe operational fields such as operation, safe code/name, message summary, phase, attempt/cursor/job ids already present in internal hosted-run logs, and content hashes/refs already used for integrity.
- Preserve unrelated dirty work in the shared tree and avoid widening into hosted web retry policy or production data cleanup.

## Tasks

1. Register the work and inspect current error/log plumbing.
2. Delegate the Tini subreaper image-contract fix to a worker.
3. Add dedicated hosted bundle validation error-code/name mapping.
4. Add structured Cloudflare runner/container log details for invalid bundle archive failures.
5. Add or update focused tests.
6. Run focused verification, required audit passes, close the plan, and commit if safe.

## Verification

- Focused hosted-execution observability tests.
- Focused Cloudflare runner/container/image tests.
- `pnpm --dir apps/cloudflare verify` or truthful scoped equivalent if unrelated dirty work blocks broader commands.
- `pnpm typecheck` unless blocked by unrelated pre-existing branch state.

Completed:

- Focused hosted-execution observability test passed.
- Focused Cloudflare runner/container/entrypoint/image tests passed.
- `pnpm --dir packages/hosted-execution typecheck` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir packages/hosted-execution test:coverage` passed.
- `pnpm --dir apps/cloudflare verify` passed.
- `pnpm test:smoke` passed.
- `pnpm typecheck` passed.
- Scoped `bash scripts/workspace-verify.sh test:diff ...` passed, including affected reverse dependents.
- Required `coverage-write` and `task-finish-review` audit passes completed; final-review findings were fixed before reruns.
Completed: 2026-04-25
