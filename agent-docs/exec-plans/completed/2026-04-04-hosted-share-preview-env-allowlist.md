# 2026-04-04 Hosted Share Preview And Env Allowlist Simplification

## Goal

Remove the dead hosted-share `previewJson` persistence seam and shrink hosted runner env forwarding from broad prefix families to explicit exact keys.

## Scope

- `apps/web/prisma/**`
- `apps/web/src/lib/hosted-share/**`
- `apps/web/test/hosted-share-service.test.ts`
- `apps/cloudflare/src/hosted-env-policy.ts`
- Focused Cloudflare tests/docs for runner env policy
- `ARCHITECTURE.md` if the hosted runner contract wording needs to reflect the exact-key cutover

## Constraints

- Preserve unrelated dirty-tree work already in flight.
- Treat this as a high-risk hosted storage and trust-boundary change.
- Do not broaden hosted user env admission; this task is about removing the legacy share preview column and tightening runner forwarding.
- Keep provider and hosted-assistant runtime paths working by forwarding only explicit keys that the repo documents and tests.

## Plan

1. Remove `previewJson` from the hosted-share Prisma model, migration path, and read helpers now that create-path writes already omit it.
2. Update hosted-share acceptance/page data code and focused tests to derive previews directly from the encrypted share pack.
3. Replace prefix-based runner env forwarding with an exact-key allowlist covering only the documented worker vars/secrets and hosted-assistant config keys.
4. Run focused verification plus direct scenario proof for the env-policy behavior, then complete the required final audit and scoped commit.

## Progress

- Done: removed the hosted-share `previewJson` field from the Prisma schema, added a drop-column migration, and cut the fallback preview reader so share previews now derive directly from the encrypted pack.
- Done: replaced runner prefix forwarding with an exact-key allowlist, including explicit hosted-assistant config keys and the documented provider/channel/runtime keys that the runner still needs.
- Done: updated focused regression coverage for hosted share and runner env policy.
- Done: fixed the hosted-assistant custom API-key alias regression found in final review so `HOSTED_ASSISTANT_API_KEY_ENV` can still point at nonstandard safe aliases without reopening prefix-based forwarding.
- Verification:
  - `pnpm --dir . exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-share-service.test.ts --no-coverage`
  - `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/node-runner-hosted-assistant.test.ts apps/cloudflare/test/user-env.test.ts apps/cloudflare/test/deploy-automation.test.ts --no-coverage`
  - `pnpm --dir apps/web lint` (passes with pre-existing warnings only)
  - `pnpm typecheck` is blocked in this sandbox before changed files by `tsx` IPC `listen EPERM` during the `apps/web` route-stub helper
  - `pnpm test` is blocked in this sandbox before changed files by the same `tsx` IPC `listen EPERM`
  - `pnpm test:coverage` is blocked in this sandbox by the same `tsx` IPC `listen EPERM`, and the Cloudflare Workers lane also hits Wrangler `EPERM` writing logs / binding localhost
- Final review:
  - Required `task-finish-review` found one medium regression in hosted-assistant custom API-key alias forwarding; fixed and covered with focused tests.
  - Requested `pnpm review:gpt --send --chat-url https://chatgpt.com/c/69d0b8a4-6918-839c-bf1d-a9651ad2979c --preset simplify --prompt 'Review the just-completed local changes for final bugs, regressions, and behavior-preserving simplification opportunities. Focus on the current changes only and keep findings concrete.'` failed in this sandbox with the same `tsx` IPC `listen EPERM`, so no outbound review request was actually sent.
- Direct proof note: the focused hosted-share and runner-env regression suites are the highest-signal executable proof currently available in-tree because the repo baseline is blocked by sandbox IPC/runtime restrictions rather than by changed-code failures.

## Remaining

- Close the active plans and create the scoped commit.
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
