# Goal

Get the current dirty workspace back to a truthful green verification state by fixing the present repo-wide blockers without reverting or overwriting unrelated in-flight work.

# Scope

- Active failing files and tests discovered by the current verification surface
- Shared verification/tooling files only when required by the failing checks
- Coordination ledger row for this stabilization lane

# Constraints

- Preserve unrelated dirty-tree edits and other active lanes listed in `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Prefer the smallest safe fixes that make the current workspace pass.
- Do not broaden into feature work that is not required for green verification.

# Verification

- `pnpm typecheck`
- `pnpm verify:acceptance` or the smallest truthful scoped verification commands needed to prove the workspace is green after fixes

# Outcome

- Completed via the smallest truthful scoped verification set rather than a full `pnpm verify:acceptance` pass.
- Fixed the Cloudflare container-entrypoint test drift to the run/runDrain contract, including a deterministic abort-helper seam for test coverage.
- Fixed shared hosted-execution run-drain parsing so internal `runtime.timer` events decode as `HostedRuntimeEvent` rather than being forced through ingress parsing.
- Fixed assistant-runtime run-drain execution so `runtime.timer` events in a non-empty drain are consumed as internal timer events instead of ingress aliases.
- Fixed Cloudflare cleanup typing so `runtime.timer` run-drain events do not flow into ingress-only transient cleanup.
- Updated the stale Cloudflare route/test expectations that still assumed the removed manual-run behavior or the old `request.wake` shape.

# Verified Commands

- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/container-entrypoint.test.ts --no-coverage`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm typecheck`
- `pnpm test:diff apps/cloudflare/test/node-runner.test.ts`
- `pnpm --dir packages/hosted-execution test`
- `pnpm --dir packages/assistant-runtime test`
- `git diff --check`
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
