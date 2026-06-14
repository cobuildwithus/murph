# Web CSP Third-Party Guard

## Goal

Prevent `withmurph.ai` from silently executing typo-squatted or injected third-party
scripts like the malicious CookieYes lookalike seen on another site.

## Scope

- Add or tighten hosted web browser security headers, especially CSP.
- Keep the policy centralized and testable.
- Add focused tests that fail if arbitrary third-party script origins become allowed.

## Non-Goals

- No dependency changes.
- No UI redesign.
- No deploy during this task.

## Current State

- Implementation complete.
- Focused CSP/header tests now assert exact production script origins and new
  security-header values.
- Existing checkout has unrelated dirty work; preserve it.

## Verification Plan

- Focused hosted-web tests for header policy.
- Hosted web typecheck/lint or the repo-required scoped lane if practical.
- Required security/privacy and completion audits for the trust-boundary change.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/next-config.test.ts --no-coverage`
  passed after final review fixes.
- `bash scripts/workspace-verify.sh test:diff apps/web/next.config.ts apps/web/test/next-config.test.ts agent-docs/exec-plans/active/2026-06-12-web-csp-third-party-guard.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  passed before final review fixes.
- Final security/privacy review found no credible medium-or-higher issue; it
  noted the pre-existing residual risk from `script-src 'unsafe-inline'` and the
  intentional compatibility tradeoff in `Cross-Origin-Opener-Policy`.
- Task-finish review found no blocking issue; accepted low findings tightened
  the exact script-source and header-value assertions and updated this plan.
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
