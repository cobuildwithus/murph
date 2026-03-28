# Execution Plan: Hosted Follow-Up Fixes

## Goal

Land the final reviewed hosted follow-up fixes across the hosted web outbox, Cloudflare replay handling, hosted share payload auth, and shared proxy-host seams without widening into unrelated hosted runtime work.

## Scope

- `apps/web/src/lib/hosted-execution/outbox.ts`
- targeted `apps/web` hosted execution and hosted share route/service tests
- `apps/web/app/api/hosted-share/internal/[shareId]/payload/route.ts`
- `apps/web/src/lib/hosted-share/{service.ts,shared.ts}`
- `apps/cloudflare/src/{runner-env.ts,runner-container.ts,runner-outbound.ts}`
- `apps/cloudflare/src/user-runner/runner-queue-store.ts`
- targeted `apps/cloudflare` runner outbound, node runner, and user-runner tests
- `packages/hosted-execution/src/{callback-hosts.ts,index.ts}`
- `packages/assistant-runtime/src/{hosted-device-sync-runtime.ts,hosted-runtime/events/share.ts}`
- targeted `packages/assistant-runtime` tests as needed

## Requested Behavior

1. Hosted outbox idempotency checks must compare typed payload semantics rather than raw JSON stringification.
2. Durable Object replay Bloom-filter hits must not be treated as authoritative consumed-state.
3. Hosted share payload reads must require the trusted hosted-execution user binding and verify the share is currently claimed or consumed by that member.
4. Hosted share payload proxy auth must require the dedicated share token instead of falling back to the broad hosted execution token.
5. The worker proxy hostnames for device-sync and share-pack should be centralized in `packages/hosted-execution`.
6. Remove or inline the assistant-runtime device-sync control-plane shim if it no longer carries meaningful logic and the import graph stays simple.

## Constraints / Invariants

- Preserve adjacent in-flight hosted/device-sync edits already present in the worktree.
- Keep the share-pack route fail-closed once hardened; do not reintroduce a broad-token fallback in code or tests.
- Treat the replay filter as an optimization hint only; exact tombstones remain the source of truth.
- Keep new shared constants additive and narrow; do not redesign the broader hosted callback surface in this pass.

## Verification Plan

- Focused Vitest runs for hosted outbox, hosted share routes/services, runner outbound, node runner, user-runner, and assistant-runtime hosted HTTP/device-sync coverage.
- Full required repo verification after integration: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Required completion audits via spawned subagents: `simplify`, `test-coverage-audit`, `task-finish-review`.
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
