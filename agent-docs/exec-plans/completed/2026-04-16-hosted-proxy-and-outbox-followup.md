# Fix proxy token fail-closed and legacy outbox compat

Status: completed
Created: 2026-04-16
Updated: 2026-04-16

## Goal

- Close the remaining hosted trust-boundary gap so internal worker requests fail closed without the per-run proxy token, and keep surviving legacy web outbox reference payload rows from being terminally stranded during rollout.

## Success criteria

- Internal-host fetches from the Cloudflare runtime throw or reject when the per-run proxy token is absent instead of silently issuing unsigned requests.
- Worker-side runner outbound auth rejects both missing and wrong proxy tokens for internal hosts.
- Hosted web outbox no longer marks legacy reference payload rows as terminal permanent failures; the compatibility behavior is explicit and regression-tested.
- Focused Cloudflare and apps/web tests cover the missing-token boundary and legacy reference-payload behavior.

## Scope

- In scope:
- `apps/cloudflare/src/runtime-platform.ts`, `apps/cloudflare/src/runner-outbound/shared.ts`, and focused Cloudflare tests for proxy-token enforcement.
- `apps/web/src/lib/hosted-execution/outbox.ts` and focused apps/web tests for legacy reference-payload handling.
- Out of scope:
- Broader hosted outbox schema cleanup and unrelated hosted runtime/device-sync changes already in flight.
- New control-plane seams for fetching staged payload bodies from Cloudflare-owned storage.

## Constraints

- Technical constraints:
- Preserve existing internal-host routing for correctly signed requests while making missing-token paths fail closed.
- Keep the outbox legacy fix minimal and safe even though web no longer owns a staged-payload store.
- Product/process constraints:
- Avoid disturbing unrelated dirty worktree changes and existing active hosted lanes.
- Use focused verification lanes that truthfully cover `apps/cloudflare` and `apps/web`.

## Risks and mitigations

1. Risk: Tightening the proxy-token boundary could break local loopback or current runner-platform expectations.
   Mitigation: Update the fetch wrapper and receiver together, then add direct missing-token and wrong-token assertions in the focused Cloudflare tests.
2. Risk: Web cannot safely reconstruct every historical staged payload body.
   Mitigation: Keep legacy reference envelopes retryable and non-prunable with an explicit compatibility error instead of turning them into terminal failed rows, and lock that behavior in apps/web tests.

## Tasks

1. Inspect the reported trust-boundary and legacy-payload findings, plus the current focused test coverage.
2. Implement the Cloudflare fail-closed proxy-token path and add direct regression coverage.
3. Implement the hosted web legacy reference-payload compatibility behavior, update focused tests, and run verification.

## Decisions

- Do not add a new staged-payload hydration seam from web to Cloudflare in this follow-up; keep the legacy outbox fix bounded to safe retry/compat handling.

## Verification

- Commands to run:
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --maxWorkers=1 apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-outbound.test.ts`
- `pnpm test -- test/hosted-execution-outbox.test.ts`
- `pnpm typecheck`
- Expected outcomes:
- Focused Cloudflare tests prove internal requests fail closed on missing or wrong proxy tokens.
- Focused apps/web outbox tests prove legacy reference rows stay actionable without becoming terminally pruned failures.
Completed: 2026-04-16
