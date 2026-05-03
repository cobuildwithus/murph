# Add hosted web session hygiene cron

Status: active
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Add hosted web-session database hygiene to the existing protected Vercel retention cron so stale expired/revoked `HostedWebSession` rows do not accumulate after they have been unusable for 30 days.

## Success criteria

- Existing session authentication semantics stay unchanged: expired or revoked sessions remain rejected by the resolver, and cleanup only deletes stale metadata rows.
- The hourly hosted retention cron deletes rows where `expiresAt` is older than the 30-day retention cutoff or `revokedAt` is older than the same cutoff.
- The cleanup summary and focused tests cover the web-session deletion count and Prisma filter.

## Scope

- In scope:
  - `apps/web` hosted retention cleanup code and focused tests.
  - Existing Vercel cron route summary tests if needed.
- Out of scope:
  - Auth resolver behavior, cookie lifetime, session issuance, schema/index changes, and account-deletion semantics.

## Constraints

- Technical constraints:
  - Reuse the existing protected Vercel cron/maintenance pattern.
  - Do not introduce raw token output, user identifiers, or auth metadata logging.
- Product/process constraints:
  - Treat this as retention/index-size hygiene, not an auth correctness fix.

## Risks and mitigations

1. Risk: Deleting live or recently expired sessions earlier than intended.
   Mitigation: Delete only rows with `expiresAt` or `revokedAt` before the 30-day cutoff, not all expired/revoked rows.

## Tasks

1. Inspect existing hosted retention cron and Prisma session model.
2. Add stale web-session cleanup and expose its deletion count.
3. Update focused hosted web retention tests.
4. Run routed verification and required audits.
5. Close the plan and commit the scoped change if safe.

## Decisions

- Reuse `/api/internal/hosted-execution/retention/cron` rather than adding another schedule because it is already the hosted database-retention cron.

## Verification

- Commands to run:
  - Focused hosted web retention tests.
  - Routed app verification or truthful diff verification per repo policy.
  - Required security/privacy, coverage-write, and final review audit passes.
- Expected outcomes:
  - Focused tests pass and prove the retention cutoff/filter.
  - Broader checks either pass or any unrelated existing blocker is named with evidence.
