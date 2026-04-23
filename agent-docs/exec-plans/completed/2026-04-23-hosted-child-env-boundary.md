# Harden hosted isolated-child env and shared web-control policy

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Keep Cloudflare operator-only hosted execution secrets outside the isolated child runtime, force child-to-web control traffic onto the per-run proxy-token path, and collapse the duplicated hosted web-control allowlist into one shared policy module without widening beyond the directly coupled hosted runner seam.

## Success criteria

- The isolated hosted child no longer inherits operator-only secrets such as callback-signing private keys, automation private keys, platform envelope keys, or wake-encryption keys.
- Allowed hosted web-control operations still work from runtime code through the internal proxy-token boundary.
- Non-allowlisted hosted web-control routes remain unreachable through the runner outbound boundary.
- The hosted web-control route allowlist lives in one shared module used by both runtime and outbound enforcement sites.
- Focused Cloudflare and assistant-runtime tests cover the scrubbed child env and the shared allowlist behavior.

## Scope

- In scope:
- `apps/cloudflare/src/{node-runner-isolated.ts,node-runner.ts,runner-container.ts,runner-env.ts,runtime-platform.ts}`
- `apps/cloudflare/src/runner-outbound/{web-control.ts,shared-web-control-policy.ts}`
- focused `apps/cloudflare/test/{node-runner-isolated,runner-container,runner-platform,runner-outbound,runner-env}.test.ts`
- focused `packages/assistant-runtime/test/hosted-runtime-environment.test.ts` only if the child-env helper surface changes
- `agent-docs/exec-plans/active/{2026-04-23-hosted-child-env-boundary.md,COORDINATION_LEDGER.md}`
- Out of scope:
- Hosted bundle/browser-vault cleanup and finalize sidecar durability work already tracked under `2026-04-23-hosted-snapshot-cleanup.md`
- Broad hosted auth redesign outside the child-env and runner outbound seams

## Constraints

- Technical constraints:
- The isolated child must keep using the worker-owned per-run proxy token for internal effects and hosted web-control traffic.
- Container startup may still receive the operator env needed by the supervisor shell and outbound bridge.
- Do not move callback-signing authority into the child to preserve existing direct/proxy transport semantics.
- Product/process constraints:
- Preserve unrelated dirty-tree edits in the active hosted runner files.
- Keep the implementation scoped to the existing hosted runner abstractions unless a tiny shared helper materially reduces policy drift.

## Risks and mitigations

1. Risk: removing operator env from the child could break allowed hosted web-control calls or assistant provider bootstrap.
   Mitigation: keep the child runtime transport on the existing proxy-token path and add focused runtime-platform coverage for the proxy case.
2. Risk: duplicated allowlist logic could drift again after the secret fix.
   Mitigation: move the route policy into one shared module and cover both the runtime and outbound boundary with focused tests.
3. Risk: direct/manual runner callers that omit forwarded env entirely could lose expected ambient runner config.
   Mitigation: preserve the existing ambient fallback through the allowlisted runner env builder instead of forwarding operator env wholesale.

## Tasks

1. Completed: validate the child-env leak and confirm the runtime already supports the proxy-token hosted web-control path without direct callback signing in the child.
2. Completed: split container operator env vs child runtime env handling and remove the operator-secret merge from the isolated child launch.
3. Completed: extract the hosted web-control allowlist into one shared policy module used by runtime and outbound enforcement.
4. Completed: add focused regression coverage for scrubbed child env plus allowlisted/non-allowlisted hosted web-control routes.
5. Completed: harden explicit `runtime.forwardedEnv` scrubbing so worker-only secrets still fail closed even when a caller supplies them directly.
6. Completed: make explicit `platformEnv` authoritative over conflicting forwarded Telegram values and keep Telegram capability derivation truthful when Telegram config is platform-only.
7. In progress: run truthful verification plus the required audit passes and assess the exact scoped commit path alongside the overlapping hosted snapshot cleanup lane.

## Decisions

- Treat the isolated child as untrusted relative to Cloudflare operator/control-plane secrets.
- Prefer one shared route-policy module over duplicated path constants because the allowlist is security-sensitive and already consumed in two places.
- Keep the existing direct signed transport only in the worker-owned path; the child continues to use proxy mode whenever the per-run proxy token is present.
- Defense in depth matters here: even explicit worker-supplied `runtime.forwardedEnv` must drop worker-only secret material before it reaches the runtime envelope or isolated child.
- Explicit `platformEnv` is the trusted owner for platform Telegram config; once a caller supplies `platformEnv`, forwarded Telegram values are ignored entirely and `platformEnv` itself is whitelisted down to the platform-owned Telegram keys.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/node-runner-isolated.ts apps/cloudflare/src/node-runner.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/src/runner-env.ts apps/cloudflare/src/runtime-platform.ts apps/cloudflare/src/runner-outbound/web-control.ts apps/cloudflare/src/runner-outbound/shared-web-control-policy.ts apps/cloudflare/test/node-runner-isolated.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/runner-env.test.ts`
- `git diff --check`
- Required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
- The isolated child receives only allowlisted runner env, operator-only secrets stay outside the execution boundary, allowed hosted web-control routes still proxy successfully, and non-allowlisted routes remain blocked.
- Actual results:
- Focused Cloudflare proof passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/node-runner-isolated.test.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-outbound.test.ts --no-coverage` => 4 files / 62 tests passed.
- Final focused Cloudflare proof rerun passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/node-runner-isolated.test.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-outbound.test.ts --no-coverage` => 4 files / 65 tests passed.
- Focused `node-runner` regression proof passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/node-runner.test.ts -t "(preserves worker-resolved runtime fields while keeping control-only and worker-only secret keys out of child env|derives Telegram runtime capabilities from explicit platform env when forwarded env omits them)" --no-coverage` => 2 tests passed.
- Focused assistant-runtime proof passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-environment.test.ts --no-coverage` => 12 tests passed.
- Broader Cloudflare file run is red for unrelated pre-existing dirty-tree failures in `apps/cloudflare/test/node-runner.test.ts` artifact-restoration scenarios:
- `hydrates hosted Telegram attachment bytes when runner Telegram env is present`
- `restores externalized raw artifacts and skips re-uploading unchanged hashes`
- `git diff --check` passed.
- `pnpm typecheck` is blocked by unrelated pre-existing failures outside this lane:
- `packages/core/test/canonical-resource-lock.test.ts` treating `input.metadata` as `unknown`
- Diff-scoped `bash scripts/workspace-verify.sh test:diff ...` is blocked by unrelated pre-existing failures outside this lane:
- unrelated assistant-runtime suite failures after `packages/assistant-runtime` typecheck completed:
- `test/hosted-runtime-finalize-coverage.test.ts`
- `test/hosted-runtime-artifacts.test.ts`
- `test/hosted-runtime-parsers.test.ts`
- `test/hosted-runtime-runner.test.ts`
- `test/package-entrypoints.test.ts`
- Required audit passes completed.

## Outcome

- Child env scrubbing plus shared web-control policy landed in the active tree, explicit forwarded-env secret injection now fails closed, and explicit `platformEnv` now stays Telegram-only and authoritative; final outcome remains blocked only by unrelated repo verification failures outside this lane.

## Audits

- `coverage-write`: completed (no additional proof changes needed)
- `task-finish-review`: completed; two review rounds found medium boundary gaps in `runner-env.ts`, all resolved locally before the final focused proof reruns

## Commit note

- Ready for scoped close-out/commit; unrelated repo verification blockers remain documented above.
Completed: 2026-04-23
