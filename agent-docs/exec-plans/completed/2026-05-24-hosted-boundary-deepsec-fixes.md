# Hosted Boundary DeepSec Fixes

## Goal

Close the four DeepSec-reported hosted trust-boundary gaps with the smallest
durable changes that preserve normal local and hosted behavior.

Success criteria:

- Hosted assistant execution cannot use profile/env-controlled executable
  selectors, hosted Codex homes, or writable PATH entries for the Codex child
  process.
- Hosted CLI device commands cannot bypass the hosted bridge with an explicit
  control-plane base URL.
- Child-reachable web-control routes cannot fetch raw hosted OAuth token
  bundles through the runtime snapshot surface.
- Runner outbound forwarding derives hosted user authority only from the bound
  invocation user and strips child-supplied hosted authority headers.

## Constraints

- Keep the fix narrow and fail closed at trust boundaries.
- Preserve local/non-hosted developer behavior unless it is part of the hosted
  authority boundary.
- Do not expose raw tokens, user ids, local paths, headers, or provider
  payloads in tests, logs, docs, or handoff.
- Preserve unrelated active hosted-runner and Temporal work.

## Plan

1. Inspect the flagged call paths and nearby tests.
2. Add fail-closed hosted-mode guards at the executable and device bridge
   boundaries.
3. Minimize runtime snapshot data reachable through child web-control.
4. Strip child-supplied hosted authority headers before Worker-to-web
   forwarding.
5. Add focused regression tests for each boundary.
6. Run the required focused verification, security/privacy audit, coverage
   audit, and final review.

## Verification

Completed:

- `pnpm --dir packages/assistant-engine exec vitest run --config
  vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts
  --no-coverage packages/cli/test/device-cli.test.ts`
- `pnpm --dir packages/device-syncd exec vitest run --config
  vitest.config.ts --no-coverage test/hosted-runtime.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts
  --no-coverage apps/web/test/device-sync-hosted-runtime-authority.test.ts
  apps/web/test/device-sync-internal-runtime.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  --no-coverage apps/cloudflare/test/runner-outbound.test.ts
  apps/cloudflare/test/runner-platform.test.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run --config
  vitest.config.ts --no-coverage test/hosted-device-sync-runtime.test.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run --config
  vitest.config.ts --no-coverage test/hosted-runtime-codex-config.test.ts`
- `pnpm --dir packages/hosted-execution exec vitest run --config
  vitest.config.ts --no-coverage test/hosted-runtime-control.test.ts`
- Targeted typechecks for `packages/assistant-engine`, `packages/cli`,
  `packages/device-syncd`, `packages/assistant-runtime`,
  `packages/hosted-execution`, `apps/web typecheck:prepared`, and
  `apps/cloudflare`.
- `git diff --check`
- Required `security-privacy-review` audit, then rerun after medium findings
  were fixed: no remaining findings.
- Required final review audit found hosted `codexHome`, tokenless OAuth
  hydration, hosted Codex PATH, parser-expectation, and CLI parser coverage
  gaps; all were fixed with focused regressions.
- Follow-up final review found the hosted E2E stub command was omitted from
  hosted direct CLI env projection; fixed with env projection and production
  ignore regressions.

Blocked:

- `pnpm typecheck` and `pnpm test:diff` stop on a pre-existing raw-log guard
  finding in `scripts/murph-age/r1609-current-research-age-model-stack.ts`,
  which is outside this task's working set.
Status: completed
Updated: 2026-05-23
Completed: 2026-05-23
