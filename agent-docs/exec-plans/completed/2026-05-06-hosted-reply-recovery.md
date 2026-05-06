# Hosted Reply Recovery

## Goal

Fix two hosted local reply failures cleanly:

- Conversation input imported alongside system mailbox work must still run promptly or schedule an immediate follow-up wake.
- Hosted Codex continuity restore must not intermittently fail on live warm-container `.codex-hosted` runtime state, while cold bundle restore remains authoritative.

Success means a Linq text that arrives during pending system mailbox work is not stranded, Codex continuity cold restore remains fail-closed, warm cache hits tolerate live Codex home files while still validating required continuity, and targeted tests cover both regressions.

## Constraints

- Preserve hosted mailbox ordering, checkpoint fencing, outbox idempotency, and Codex continuity integrity checks.
- Do not broaden hosted Codex home snapshots or cold bundle restore to arbitrary files.
- Do not log raw payloads, full user ids, secrets, local usernames, or home paths.
- Keep fixes narrow; avoid speculative new scheduling or snapshot abstractions.
- Coordinate with overlapping active hosted runtime latency and Codex operator-memory work.

## Plan

1. Trace the system mailbox early-return path and add the smallest scheduling or continuation fix.
2. Trace the Codex home restore verifier path and separate cold authoritative restore from warm live-runtime cache validation.
3. Add focused regression tests in the owning packages.
4. Run targeted coverage/typecheck and required completion audits.

## Verification

- `pnpm --dir packages/runtime-state test -- hosted-bundle.test.ts` passed.
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-assistant-phase.test.ts hosted-runtime-workspace-restore-codex-continuity.test.ts` passed.
- `pnpm --dir packages/runtime-state typecheck` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm typecheck` blocked by unrelated dirty work in `apps/cloudflare/src/runtime-bridge-workspace.ts` raw-payload guard and `scripts/dev-hosted-local/stack.ts` `findLast` target/implicit-any errors.
- Security/privacy, coverage, and finish-review audits completed. Actionable gaps addressed except the intentional warm-cache live-state tolerance.
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
