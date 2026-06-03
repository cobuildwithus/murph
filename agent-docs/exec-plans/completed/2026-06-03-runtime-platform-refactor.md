# Runtime Platform Refactor

## Goal

Split `apps/cloudflare/src/runtime-platform.ts` into named Cloudflare-owned modules while preserving the current public import surface and runtime behavior.

## Success Criteria

- `apps/cloudflare/src/runtime-platform.ts` becomes a thin compatibility wrapper.
- `apps/cloudflare/src/runtime-platform/index.ts` owns the stable re-export surface.
- Trust-boundary concerns stay explicit in named modules, especially authority headers, control-plane fetch diagnostics, web-control transport, provider fetch, public internet fetch, artifacts, workspace snapshots, and runtime ports.
- No new generic port-factory framework, feature flag, compatibility mode, or behavior fork is introduced.
- Existing callers keep importing from `./runtime-platform.ts`.
- Verification follows the `apps/cloudflare` lane or reports unrelated blockers with focused proof.

## Scope

- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/src/runtime-platform/**`
- Focused tests only if imports or behavior need mechanical coverage updates.

## Non-Goals

- Moving Cloudflare runtime platform code into `packages/assistant-runtime`.
- Changing write-fence, provider egress, public internet egress, artifact storage, workspace snapshot, mailbox, device-sync, browser-vault, issue export, usage record, or effects behavior.
- Refactoring active hosted invocation semantics covered by `cloudflare-hardcut-v3.md`.
- Refactoring staged dirty-ack behavior covered by `2026-05-28-device-sync-staged-dirty-ack-overlay.md`.

## Notes

- Current tree has unrelated active ledger and assistant-runtime/doc changes. Preserve them.
- The refactor intentionally cuts by concrete responsibility instead of adding a broad abstraction.
- Completed with `runtime-platform.ts` as a compatibility wrapper and concrete modules under
  `apps/cloudflare/src/runtime-platform/`.
- Current-tree verification passed: `pnpm typecheck`, `apps/cloudflare verify`,
  `packages/assistant-runtime` typecheck, focused `runner-platform.test.ts`,
  `apps/cloudflare test:workers`, workspace boundary checks, and
  `git diff --check`.
- This refactor is a stacked current-tree change: `runtime-platform` imports the
  focused `@murphai/assistant-runtime/hosted-checkpoint-bridge` subpath, so the
  hard-cut bridge package export must land before or with the runtime-platform
  module split.
Status: handoff
Updated: 2026-06-03
