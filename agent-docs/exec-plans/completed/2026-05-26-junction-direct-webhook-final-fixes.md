# Junction Direct Webhook Final Fixes

## Goal

Close final subagent-review edge cases in the Junction direct webhook payload path.

Success criteria:

- Nested timeseries webhook samples use a stable sample-derived anchor/window instead of receipt time when available.
- Queued oversized direct payloads cannot bypass the direct payload size guard at execution time.
- Direct payload execution avoids importing mismatched source-hint payloads without depending on Junction REST availability.
- Usable direct payload execution imports before Junction provider-list/source projection, with projection best-effort after import.
- Focused tests prove the new edge behavior.

## Constraints

- Preserve overlapping Junction alias-review, remote-disconnect, and prior direct-webhook dirty work.
- Do not introduce a new durable payload artifact/ref system.
- Keep changes localized to Junction provider logic and focused tests.
- Do not expose raw provider identifiers or local paths in code/tests/docs.

## Scope

- `packages/device-syncd/src/providers/junction.ts`
- `packages/device-syncd/test/junction-provider.test.ts`

## Plan

1. Derive webhook `occurredAt`/window from nested `data[]` sample timestamps when top-level timestamps are missing.
2. Enforce the direct payload byte limit when parsing queued `webhookDataJson`.
3. Require direct payload source hints to match the job hint before direct import.
4. Move usable direct payload import ahead of Junction provider-list/source projection and make the post-import projection best-effort.
5. Add focused regressions for stable nested-sample dedupe/window, queued oversized fallback, and provider-list outage after direct import.
6. Run focused tests and typecheck.

## Verification

Expected commands:

- `pnpm --dir packages/device-syncd exec vitest run test/junction-provider.test.ts --testNamePattern "<focused Junction direct webhook final fixes>"`
- `pnpm --dir packages/device-syncd typecheck`
Status: completed
Updated: 2026-05-26
Completed: 2026-05-26
