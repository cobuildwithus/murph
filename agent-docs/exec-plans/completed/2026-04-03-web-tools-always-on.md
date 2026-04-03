# Web Tools Always On

Status: completed
Created: 2026-04-03
Updated: 2026-04-03

## Goal

- Remove the `MURPH_WEB_FETCH_ENABLED` opt-in gate so `web.fetch` and `web.pdf.read` are available by default again whenever runtime `fetch` exists, while keeping the recent URL-redaction, host-blocking, and bounded PDF-timeout hardening intact.

## Success criteria

- The assistant web-read tools are present by default in the CLI harness again.
- The env toggle is no longer required for normal availability.
- The existing hardening remains in place: fragment stripping, query redaction, private-network blocking, and bounded PDF parse/extraction abort behavior.
- Required verification passes and the change is committed without touching unrelated in-flight work.

## Scope

- In scope:
- `packages/assistant-core/src/assistant/web-fetch.ts`
- `packages/assistant-core/src/assistant/web-pdf-read.ts`
- `packages/assistant-core/src/assistant-cli-tools.ts`
- `packages/cli/test/inbox-model-harness.test.ts`
- `ARCHITECTURE.md`
- `agent-docs/SECURITY.md`
- `agent-docs/index.md`
- Out of scope:
- Any broader security rollback beyond the availability gate.
- DNS rebinding or socket-pinning work.

## Constraints

- Technical constraints:
- Preserve the recent hardening behavior aside from the availability toggle.
- Product/process constraints:
- Preserve unrelated dirty-tree edits and commit only this scoped follow-up.

## Risks and mitigations

1. Risk: accidentally reintroduce the old insecure URL or timeout behavior while changing availability.
   Mitigation: keep the code diff narrow and rerun the focused harness plus full repo baseline.

## Tasks

1. Remove the env-based availability gate from assistant web tool creation/runtime checks.
2. Update docs and tool descriptions to reflect always-on guarded web-read tools.
3. Update harness tests to assert default availability while preserving hardening checks.
4. Run verification, required audit, and a scoped commit.

## Decisions

- Keep the recent hardening intact; only availability semantics change in this follow-up.

## Verification

- Commands to run:
  - `pnpm exec vitest --run packages/cli/test/inbox-model-harness.test.ts --coverage=false`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Focused harness and full repo baseline pass after the follow-up.
Completed: 2026-04-03
