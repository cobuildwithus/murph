# Hosted Email Final Cleanups

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

Tighten the hosted Cloudflare email bridge without redesigning it by fixing parser drift, self-alias handling, bootstrap channel gating, hosted verified-email reconciliation, and the hosted settings retry path.

## Scope

- Add shared hosted-email capability/self-address helpers and reuse them where hosted email readiness is decided.
- Parse `email.message.received` through the shared hosted-execution parser and cover it with a focused contract test.
- Treat both the configured hosted sender identity and the concrete inbound alias as self during parsed-email normalization.
- Prefer `Reply-To` over `From` when deriving a first-contact hosted email thread target.
- Gate hosted email auto-reply on full send readiness and stop auto-enabling hosted Linq during `member.activated`.
- Make the Worker-side hosted send implementation use the configured sender identity as the fixed sender surface.
- Reconcile hosted verified-email self-targets from hosted sender env instead of local inbox connector discovery.
- Prefer the best verified Privy email in hosted settings and expose a direct verified-email resync path that does not require a second OTP flow.

## Constraints

- Preserve the existing Worker-edge email bridge architecture.
- Keep hosted email scoped to the Cloudflare hosted lane; do not widen into a generic hosted provider framework.
- Preserve unrelated dirty worktree edits in adjacent hosted files.

## Risks

1. Hosted email behavior spans a shared parser package, inbox normalization, the hosted runtime bootstrap path, and the Worker send bridge.
   Mitigation: centralize shared readiness/self-address rules and add focused seam-level tests at each boundary.
2. The repo already has unrelated dirty changes and active lanes in neighboring hosted files.
   Mitigation: keep the diff narrow, read live file state first, and avoid touching unrelated logic.
3. Hosted settings tests run in a Node-only harness without a browser DOM.
   Mitigation: keep the UI interaction logic in pure helper functions, then pair those tests with a rendered markup assertion for the visible settings state.

## Verification Plan

- Focused tests while iterating:
  - `pnpm exec vitest run packages/hosted-execution/test/hosted-execution.test.ts packages/inboxd/test/email-connector.test.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/node-runner.test.ts --no-coverage --maxWorkers 1`
- Required repo checks before handoff:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Required completion-workflow audit passes via spawned subagents:
  - `simplify`
  - `test-coverage-audit`
  - `task-finish-review`
