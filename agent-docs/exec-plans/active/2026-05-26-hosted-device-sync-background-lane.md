# Hosted Device Sync Background Lane

## Goal

Land the next safe slice of the hosted device-sync foreground/background migration without adding a new queue, snapshot store, or standalone sync plane.

Success criteria:

- cold-start hosted mailbox import is explicitly foreground-first where safe
- legacy/background device-sync work remains preemptible and non-blocking for fresh conversation input
- webhook dirty-state handling is moved away from foreground mailbox work only if it can be done cleanly without unsafe overlap
- tests document the chosen contracts

## Constraints

- Keep architecture simple and reuse existing hosted runtime, dirty-state, and wake primitives.
- Preserve legacy `device-sync.wake` compatibility until old rows and recovery producers are safely handled.
- Do not create a new queue table or snapshot/read-model store.
- Do not inspect, print, fixture, or commit raw provider payloads, raw health data, secrets, local paths, or direct user identifiers.
- Preserve unrelated dirty work in `apps/web/test/device-sync-hosted-wake.test.ts`, `packages/device-syncd/test/public-ingress.test.ts`, and `packages/device-syncd/test/service.test.ts`.

## Plan

1. Inspect hosted mailbox import, device-sync wake, and webhook dirty-state seams.
2. Land foreground-first import and/or legacy-yield hardening if local and safe.
3. Evaluate whether webhook acceptance can stop producing foreground mailbox work without unsafe overlap; land only if clean.
4. Run focused tests, typecheck, and required audits.
5. Close the plan and commit scoped changes.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test:smoke` passed.
- `security-privacy-review` passed with no findings.
- `coverage-write` added focused clean-conversation-to-system-fallback proof and passed focused tests.

## State

Implemented. The hosted foreground runtime now imports conversation mailbox work first and imports the system lane only when that foreground import is clean. Legacy `device-sync.wake` compatibility is preserved through the existing system lane, and system mailbox maintenance yields when foreground input arrives during the run. Webhook producer changes were intentionally deferred because the relevant web/device-syncd test surface already has unrelated active dirty work.
