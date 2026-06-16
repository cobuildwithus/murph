# Hosted Runtime Wake Diagnostics

## Goal

Add metadata-only, non-blocking timing evidence for the hosted active-runtime wake path so the next latency incident can separate Temporal scheduling, Cloudflare wake delivery, runtime notification, and foreground mailbox import time.

## Constraints

- Preserve foreground reply priority over browser-vault refresh, device sync, maintenance, and idle checkpoint work.
- Do not add a new scheduler, queue, wake authority, or persisted product state.
- Keep Temporal state pointer-only.
- Do not write awaited runtime logs between message accept and provider start.
- Keep diagnostics metadata-only and free of payloads, prompts, transcripts, direct user identifiers, local paths, and secrets.

## Proposed Scope

- Capture request-local timestamps when an active runtime wake is notified, the foreground wait resolves, and foreground mailbox import starts.
- Carry those timestamps through the existing `assistant_input_staged` latency trace `phaseBreakdown.wake` metadata.
- Preserve existing dispatch/restore/boot milestones when late foreground imports add wake timing.
- Add focused coverage for parser leniency, web-store merge hardening, runtime wake propagation, and foreground milestone preservation.

## Verification

- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-runtime test -- test/hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm exec vitest run apps/web/test/hosted-runtime-latency-store.test.ts --config apps/web/vitest.workspace.ts --no-coverage --project hosted-web-store-config`
- `bash scripts/workspace-verify.sh test:diff ...`
- `pnpm typecheck`
- `pnpm test:smoke`

## Status

Implemented; verification in progress.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
