# Usage Reset Message E2E

## Goal

Verify that a hosted user who hits the monthly assistant usage limit can send a
new message again after the allowance period resets.

## Success Criteria

- The regression drives the hosted Linq webhook path through the real usage
  allowance gate.
- The pre-reset message is blocked with the deterministic usage-limit reply and
  no runner wake.
- The post-reset message creates a fresh allowance period, appends a runner
  wake, and carries a signed usage-allow decision.
- Focused web tests and typecheck pass.

## Scope

- `apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts`
- Minimal adjacent test helpers only if required

## Out Of Scope

- Homepage styling or banner copy changes.
- Billing plan logic changes.
- Cloudflare runner implementation changes.

## Plan

1. Add an e2e-style webhook regression around the monthly usage reset.
2. Assert blocked pre-reset behavior and resumed post-reset wake behavior.
3. Run focused verification and required completion audits.
4. Commit the scoped test change.

## Verification

- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-onboarding-linq-usage-reset-e2e.test.ts test/hosted-execution-usage-allowance.test.ts` passed.
- `pnpm --dir apps/web typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts agent-docs/exec-plans/active/2026-05-13-usage-reset-message-e2e.md` passed, including `apps/web verify`.
- `security-privacy-review` completed; low findings were fixed.
- `coverage-write` completed; no extra proof needed.
- `task-finish-review` completed; no findings.
Status: completed
Updated: 2026-05-13
Completed: 2026-05-13
