## Title

Land the supplied phase 9–10 hosted-run hard-cut patch on top of the current hosted-run tree.

## Goal

Merge the phase 9–10 hard cut so the hosted execution path removes the legacy hosted-wake executor surface and finalizes the run-centric protocol without trampling overlapping in-flight hosted-run work.

## Scope

- `agent-docs/references/hosted-run-protocol.md`
- `apps/cloudflare/src/{container-entrypoint,index,web-control-plane,web-control-plane-email-ingress,user-runner}.ts`
- `apps/cloudflare/src/user-runner/{runner-wake-processor,types}.ts`
- `apps/cloudflare/test/{user-runner,user-runner-hosted-wake,workers/test-hosted-control-plane-email-ingress}.test.ts`
- `apps/web/app/api/internal/{hosted-run,email-ingress}/**`
- `apps/web/src/lib/{hosted-run,hosted-onboarding,hosted-wake}/**`
- `apps/web/test/**`
- `packages/assistant-runtime/src/**`
- `packages/hosted-execution/src/**`
- Prisma schema and migration artifacts touched by the supplied patch
- required verification and audit artifacts for this slice

## Constraints

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Preserve unrelated dirty-tree edits and overlapping hosted-run rows already registered in the coordination ledger.
- Keep the hard cut limited to the patch surface; do not reopen unrelated onboarding, deploy, or product work.
- Update durable hosted-run docs when the final contract changes.

## Verification

- passed: `pnpm typecheck`
- passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/node-runner.test.ts --no-coverage`
- passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-state-store.bundle-slots.test.ts --no-coverage`
- passed: `bash scripts/workspace-verify.sh test:diff apps/cloudflare apps/web packages/assistant-runtime packages/hosted-execution scripts/dev-hosted-local agent-docs/references/hosted-run-protocol.md`
- passed: `git diff --check`

## Notes

- `git apply --check` failed against the live worktree because overlapping hosted-run files already carry local edits. Build a clean `HEAD` reference application first, then merge the final state onto the dirty tree.
- This lane is high-risk and cross-cutting across hosted web, Cloudflare, runtime contracts, and schema surfaces, so follow the full repo completion workflow including required audit passes.
- Follow-up fixes required after applying the supplied patch:
  - align Cloudflare node-runner tests with the run-drain finalization summary/result shape.
  - allow `apps/cloudflare` worker verification to pass when the hard cut intentionally removes the worker test surface.
  - update hosted web Prisma baseline guards to remove `assistantNextWakeAt` and `HostedWakeTerminal`.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
