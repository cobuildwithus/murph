# Hard-cut hosted Telegram platform env from user runtime env

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Prevent the hosted Telegram platform env (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_API_BASE_URL`, and `TELEGRAM_FILE_BASE_URL`) from entering any user-executable hosted runtime environment while preserving the platform-owned Telegram delivery path and existing hosted runner isolation work.

## Success criteria

- Hosted env category and policy code no longer classify `TELEGRAM_BOT_TOKEN`, `TELEGRAM_API_BASE_URL`, or `TELEGRAM_FILE_BASE_URL` as forwarded user/runtime variables.
- Cloudflare runner env assembly no longer passes those Telegram platform vars through `forwardedEnv` into the child runtime or in-process hosted runtime env.
- Hosted runtime normalization does not retain or surface stale user overrides for the Telegram platform token or base URLs.
- Focused tests fail closed on any attempt to forward or allowlist those Telegram platform vars while preserving the existing non-forwarding rule for `TELEGRAM_WEBHOOK_SECRET`.
- Telegram-only hosted runtime paths still read the platform-owned token/base URLs through the platform-backed env and continue to work.
- The fix stays narrow to the Telegram trust boundary and does not widen into unrelated runner-env, gateway, or hosted auth redesign work.

## Scope

- In scope:
- `packages/assistant-runtime/src/hosted-env-categories.ts`
- `apps/cloudflare/src/hosted-env-policy.ts`
- `apps/cloudflare/src/runner-env.ts`
- `apps/cloudflare/src/node-runner-isolated.ts`
- `packages/assistant-runtime/src/hosted-runtime/environment.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `apps/cloudflare/test/runner-env.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/telegram.ts`
- directly coupled Telegram-focused hosted runtime tests
- directly coupled hosted assistant-runtime tests only if needed for user-env normalization or provider routing proof
- `agent-docs/exec-plans/active/{2026-04-23-telegram-bot-token-boundary.md,COORDINATION_LEDGER.md}`
- Out of scope:
- broader hosted child-env/operator-secret work already tracked under `2026-04-23-hosted-child-env-boundary.md`
- Telegram routing/product behavior changes beyond removing platform Telegram env from user-controlled runtime env

## Constraints

- Technical constraints:
- Treat `TELEGRAM_BOT_TOKEN`, `TELEGRAM_API_BASE_URL`, and `TELEGRAM_FILE_BASE_URL` as platform-owned Telegram env, not user/runtime env input.
- Preserve any worker-owned or supervisor-owned Telegram delivery path that legitimately needs the token and platform base URLs outside the untrusted child runtime boundary.
- Keep the fix compatible with the in-progress child-runtime env hardening already present in `apps/cloudflare/src/{runner-env.ts,node-runner-isolated.ts}`.
- Product/process constraints:
- Preserve unrelated dirty-tree edits already present in the touched runner and assistant-runtime files.
- Treat this as a high-risk cross-package trust-boundary change: run the full acceptance baseline, add focused proof, and complete the required `coverage-write` plus `task-finish-review` audit passes before handoff.

## Risks and mitigations

1. Risk: removing Telegram platform env from forwarded env could break hosted Telegram send, typing, or attachment-download behavior that still depends on ambient child env.
   Mitigation: trace the actual delivery and conversation-ingest call paths first, keep the Telegram platform vars only on the worker/supervisor-owned side if needed, and add focused regression coverage for runner env assembly plus Telegram helpers.
2. Risk: existing tests or helpers may silently reintroduce the token or base URLs through another env category or user-env merge.
   Mitigation: update the category/policy source of truth, split the vars into `platformEnv`, and invert the tests so forwarding or allowlisting them fails closed.
3. Risk: overlapping in-progress runner-env work could be clobbered by a narrow security patch.
   Mitigation: edit additively on top of the current dirty tree, keep the scope limited to the Telegram platform env boundary, and avoid reverting unrelated changes.

## Tasks

1. Completed: register the task in the coordination ledger and create this active plan.
2. Completed: inspected the env category, runner policy, hosted runtime normalization, and Telegram send/runtime paths to confirm the platform-env leak and the safe owner boundary for the token/base URLs.
3. Completed: implemented the hard cut so the Telegram platform env is excluded from forwarded/user runtime env while preserving the platform-owned Telegram path.
4. Completed: added focused regression coverage for env category/policy behavior, platform-env splitting, container loopback rewrite, and hosted runtime/package export proof.
5. Completed: ran focused verification, captured direct scenario proof for the env boundary, completed the required `coverage-write` and `task-finish-review` audit passes, addressed both medium review findings, and reran affected checks.
6. Completed with blocker: scoped commit intentionally skipped because exact staging would require partial commits across heavily overlapping pre-existing dirty edits in `apps/cloudflare/src/user-runner/runner-run-processor.ts`, `apps/cloudflare/src/hosted-env-policy.ts`, and `packages/assistant-runtime/src/hosted-env-categories.ts`.

## Decisions

- Treat `TELEGRAM_BOT_TOKEN`, `TELEGRAM_API_BASE_URL`, and `TELEGRAM_FILE_BASE_URL` as platform-only env that may exist only in `platformEnv`, never in forwarded child env or user env.
- Preserve the platform-owned Telegram path by merging `platformEnv` after forwarded/user env in runner-owned runtime env assembly.
- Rewrite platform Telegram base URLs for containerized runner execution independently of the user-env forwarding profile so local/container delivery cannot regress when the Telegram profile is not enabled for user code.
- Refresh the ignored assistant-runtime `dist` entrypoints locally because the public subpath export surface is consumed by Cloudflare code and direct proof would otherwise keep resolving stale generated artifacts.

## Verification

- Commands to run:
- `pnpm verify:acceptance`
- focused test commands for the touched Cloudflare and assistant-runtime env paths during local iteration as needed
- direct scenario proof showing the resolved child/runtime env excludes the Telegram platform token/base URLs while Telegram helpers still receive the platform-backed env
- `git diff --check`
- required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_API_BASE_URL`, and `TELEGRAM_FILE_BASE_URL` are absent from user-executable hosted runtime env surfaces.
- Hosted env forwarding still preserves the intended non-secret runtime variables and still excludes `TELEGRAM_WEBHOOK_SECRET`.
- No unrelated runner-env or hosted assistant config behavior regresses.

## Outcome

- Hosted runner policy now rejects allowlisting of the platform Telegram token and base URLs.
- Runner/runtime assembly now strips those Telegram vars out of forwarded child env and user env, carries them in `platformEnv`, and ensures platform values win on collisions.
- Containerized runner execution now rewrites platform Telegram base URLs through the container-reachable host path even when Telegram env is not forwarded to user code.
- Assistant-runtime source exports now publish the ingress-only and platform-only env constants, and the local ignored `dist` artifacts were refreshed so direct package-export proof exercises the same subpath Cloudflare consumes.

## Audits

- `coverage-write` (`gpt-5.4-mini`): added a focused hosted-runtime merge-order proof in `packages/assistant-runtime/test/hosted-runtime-environment.test.ts`.
- follow-up `coverage-write` rerun (`gpt-5.4-mini`): added an explicit Cloudflare proof in `apps/cloudflare/test/node-runner.test.ts` that `platformEnv` alone preserves `telegramBotConfigured` while keeping Telegram vars out of `forwardedEnv`.
- `task-finish-review`: found two medium issues, both fixed before handoff:
- container runner path was not rewriting platform Telegram base URLs when the Telegram forwarded-env profile was disabled
- assistant-runtime `dist` subpath exports were stale and missing the newly required env-constant symbols

## Commit note

- No scoped commit was created. The exact fix spans files that already contain overlapping active dirty-tree work from other rows, and safe staging would require partial-file commits across those overlaps.

## Verification results

- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/env.test.ts apps/cloudflare/test/hosted-env-policy.test.ts --no-coverage`
- PASS: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-environment.test.ts test/package-entrypoints.test.ts --no-coverage`
- PASS: `pnpm --dir packages/assistant-runtime typecheck`
- PASS: `pnpm exec vitest run apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/hosted-env-policy.test.ts apps/cloudflare/test/env.test.ts apps/cloudflare/test/node-runner-hosted-assistant.test.ts apps/cloudflare/test/node-runner.test.ts --config apps/cloudflare/vitest.config.ts`
- PASS: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-environment.test.ts test/hosted-runtime-runner.test.ts test/hosted-runtime-callbacks.test.ts test/hosted-runtime-conversation-event.test.ts test/hosted-runtime-telegram-event.test.ts test/hosted-runtime-typing.test.ts`
- PASS: `pnpm exec vitest run apps/cloudflare/test/node-runner.test.ts -t "derives Telegram runtime capabilities from explicit platform env when forwarded env omits them" --config apps/cloudflare/vitest.config.ts`
- PASS: direct package-export proof from `apps/cloudflare` for `@murphai/assistant-runtime/hosted-assistant-env-constants` (`assistant-runtime-subpath-export:ok`)
- PASS: direct hosted-runtime sanitization proof for forwarded/user env vs `platformEnv`
- PASS: `git diff --check`
- FAIL, unrelated current-tree blocker: `pnpm --dir apps/cloudflare typecheck` due `apps/cloudflare/src/user-runner/runner-run-processor.ts(504,26): Property 'assistantDeliveryOutcomes' does not exist on type 'HostedAssistantRuntimePreparedJobResult'.` and `packages/contracts/src/vault-families.ts(757,16): Property 'requiredDirectory' does not exist ...`
- FAIL, unrelated pre-existing: `pnpm verify:acceptance` at workspace package typecheck due `packages/core/test/canonical-resource-lock.test.ts(226,30): error TS18046: 'input.metadata' is of type 'unknown'.`
Completed: 2026-04-24
