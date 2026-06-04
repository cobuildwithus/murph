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
2. Clear routing/email/phone surfaces so old provider retries cannot route into
   the fresh mailbox.
3. Use reset-specific transaction options for high-row-count accounts.
4. Require explicit environment confirmation for execute mode and redact the
   exact member id in top-level errors.
5. Add focused tests for CLI guards, count assertions, and exported helpers.
6. Run required verification and audits for the touched app/script surface.

## Verification

- Pending.
