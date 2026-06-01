# Hosted Provider Fetch Cleanup

## Goal

Remove the hosted attachment drivers' local ambient `globalThis.fetch` fallback so
hosted provider fetches are always explicit injected dependencies.

## Success Criteria

- Linq and Telegram attachment drivers do not expose or consume an
  `allowAmbientFetchForLocalRuntime` escape hatch.
- Tests inject provider/public fetch dependencies directly.
- Guard tests fail if hosted attachment drivers regain ambient fetch fallback.
- Focused hosted-runtime tests, repo typecheck, and diff-aware verification pass
  or have documented unrelated blockers.

## Constraints

- Keep the design simple: explicit dependency injection at the existing driver
  boundary, no new provider framework.
- Preserve Cloudflare as the provider credential/egress owner.
- Do not weaken fail-closed behavior when a hosted runtime platform fetch is
  missing.
- Preserve unrelated active work and ledger rows.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/events/linq.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/telegram.ts`
- `packages/assistant-runtime/test/hosted-runtime-linq-event.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-telegram-event.test.ts`
- `packages/assistant-runtime/test/hosted-provider-fetch-guard.test.ts`

## Verification Plan

- Focused assistant-runtime hosted provider/attachment tests.
- `pnpm typecheck`
- `pnpm test:diff` scoped to the touched assistant-runtime files.
- `git diff --check`
- Privacy/secret diff scan.
Status: completed
Updated: 2026-06-01
Completed: 2026-06-01
