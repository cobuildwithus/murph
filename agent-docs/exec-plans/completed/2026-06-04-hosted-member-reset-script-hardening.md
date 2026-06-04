# Hosted Member Reset Script Hardening

## Goal

Harden the per-member hosted reset script so it can reset a paid member without
forcing repayment while avoiding the known bootstrap, provider-retry,
transaction-timeout, environment-targeting, and log-redaction hazards.

## Scope

- Keep implementation changes script-scoped where possible.
- Touch `apps/web/scripts/reset-hosted-member-runtime.ts` and focused script
  tests.
- Do not edit Cloudflare Worker source in this pass; report any remaining
  Worker cleanup gap that cannot be solved from the reset script.

## Plan

1. Seed a reset-specific `member.activated` mailbox item during DB reset.
2. Clear routing/email/phone and non-launch consent surfaces so old provider
   retries cannot route into or authorize the fresh mailbox.
3. Use reset-specific transaction options for high-row-count accounts.
4. Require explicit environment confirmation for execute mode and redact the
   exact member id in top-level errors.
5. Add focused tests for CLI guards, count assertions, and exported helpers.
6. Run required verification and audits for the touched app/script surface.

## Verification

- `pnpm --dir apps/web test reset-hosted-member-runtime-script.test.ts` passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-entrypoint.test.ts -t "imports system bootstrap before initial conversation import for cold vaults"` passed.
- `git diff --check -- apps/web/scripts/reset-hosted-member-runtime.ts apps/web/test/reset-hosted-member-runtime-script.test.ts agent-docs/exec-plans/active/2026-06-04-hosted-member-reset-script-hardening.md` passed.
- Redaction scan over the touched reset files passed.

## Review Outcome

- Operator safety/privacy sub-agent findings were addressed: Cloudflare cleanup
  now requires Durable Object state deletion, execute mode requires an execution
  target fingerprint, and unknown-argument errors no longer echo raw input.
- Database invariant sub-agent findings were addressed: device webhook trace
  owner rows are captured before device connections are deleted, then deleted
  explicitly.
- The runtime/bootstrap sub-agent hung; local hosted-runtime review replaced it.
  The reset now appends a fresh `member.activated` system mailbox item, preserves
  the member's pending activation timezone for cold-vault bootstrap, and clears
  non-launch consent rows so optional channel/device consent cannot carry over
  after routing/device state is wiped.
Status: completed
Updated: 2026-06-04
Completed: 2026-06-04
