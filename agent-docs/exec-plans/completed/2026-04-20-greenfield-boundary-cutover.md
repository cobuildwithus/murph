## Title

Land the supplied greenfield boundary cutover patch for source anchors and hosted conversation ingress ownership.

## Goal

Apply the supplied package-boundary cleanup so subpath-only packages stop resolving through stale `src/index.ts` anchors, hosted conversation ingestion in `assistant-runtime` depends on a hosted-specific inbox adapter instead of generic connector internals, and focused guard tests enforce those boundaries.

## Scope

- `config/workspace-source-resolution.ts`
- affected Vitest alias configs under `apps/cloudflare` and `packages/**`
- `packages/inboxd/package.json`
- `packages/inboxd/src/connectors/hosted-conversation.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/{conversation,linq,telegram}.ts`
- focused boundary and alias tests required by the supplied patch

## Constraints

- Preserve unrelated dirty-tree edits, especially overlapping `packages/assistant-runtime/**`, `apps/cloudflare/**`, and `apps/web/**` work.
- Treat the supplied patch as bounded intent, not overwrite authority; adjust only where the current worktree has drift.
- Keep the change limited to source-anchor resolution, hosted conversation adapter ownership, and direct guard-test fallout.

## Verification

- passed: `pnpm --dir packages/assistant-runtime test`
- passed: `git diff --check`
- failed for pre-existing unrelated reasons: `bash scripts/workspace-verify.sh test:diff config/workspace-source-resolution.ts apps/cloudflare/vitest.shared.ts packages/assistant-cli/vitest.config.ts packages/assistant-engine/vitest.config.ts packages/assistant-runtime/src/hosted-runtime/events/conversation.ts packages/assistant-runtime/src/hosted-runtime/events/linq.ts packages/assistant-runtime/src/hosted-runtime/events/telegram.ts packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/hosted-runtime-conversation-event.test.ts packages/assistantd/vitest.config.ts packages/cli/vitest.config.ts packages/cli/vitest.workspace.ts packages/gateway-local/vitest.config.ts packages/inboxd/package.json packages/inboxd/src/connectors/hosted-conversation.ts packages/inboxd/vitest.config.ts packages/messaging-ingress/vitest.config.ts packages/operator-config/vitest.config.ts packages/setup-cli/vitest.config.ts scripts/workspace-boundaries/import-policy-rules.mjs scripts/workspace-boundaries/import-policy-rules.test.ts scripts/workspace-source-resolution.test.ts`
- failed for pre-existing unrelated reasons: `pnpm typecheck`

## Notes

- The supplied patch also adds focused tests for the missing-path source-anchor guard and the hosted-ingress import policy guard; keep those with the owning boundary/tooling surfaces rather than widening into unrelated runtime changes.
- The only patch-local fallout was a stale `packages/assistant-runtime/test/hosted-runtime-conversation-event.test.ts` mock that still targeted generic inbox connector internals after the hosted adapter cutover; updating it to mock `@murphai/inboxd/connectors/hosted-conversation` and `@murphai/hosted-execution/hosted-email` restored the intended boundary.
- The scoped diff lane reached `apps/cloudflare verify` because `apps/cloudflare/vitest.shared.ts` changed, but it failed on pre-existing `HostedExecutionAssistantCronTickWake` typing drift in Cloudflare tests that this patch did not touch.
- Repo `pnpm typecheck` is still red on a pre-existing `packages/device-syncd/src/service.ts` argument-count error unrelated to this boundary patch.
