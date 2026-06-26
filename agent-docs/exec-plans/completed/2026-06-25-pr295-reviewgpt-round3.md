# PR 295 ReviewGPT Round 3

## Goal

Resolve accepted ReviewGPT round-3 findings on PR 295:

- Phone-call request idempotency must not collapse distinct approved call briefs.
- Retell signed callbacks should tolerate realistic long-call payloads without
  persisting raw transcripts or webhook bodies.

## Constraints

- Keep one `HostedPhoneCall` row per real call.
- Use exact brief identity for call request idempotency; do not add attempt/task
  tables or broader workflow state.
- Keep Retell args-only disabled so Murph receives server-owned call metadata,
  not model-supplied call ids.
- Do not log or persist raw Retell transcripts or callback bodies.

## Key Decisions

- Include the full bounded `HostedPhoneCallBrief` in the request-key hash.
- On duplicate request keys, compare the stored brief with the incoming brief and
  fail closed on mismatch.
- Raise Retell callback body caps to bounded multi-megabyte limits and add route
  regressions above the previous caps.

## Plan

1. Update request-key derivation and duplicate-key service validation.
2. Raise Retell raw-body limits and add signed oversized callback tests.
3. Run affected tests/typechecks, commit, push, and rerun ReviewGPT.

## Verification

- Passed: `pnpm --dir packages/assistant-engine exec vitest run test/assistant-phone-calls.test.ts`
- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-routes.test.ts --no-coverage`
- Passed: `pnpm --filter @murphai/hosted-web typecheck`
- Passed: `pnpm --filter @murphai/assistant-engine typecheck`
- Passed: `git diff --check`
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
