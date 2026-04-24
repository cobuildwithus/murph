# Fix stale hosted-run acquire retry loop

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Stop production Durable Object alarm retry loops when a bound Cloudflare runner user no longer exists in the hosted web database after DB wipe/cascade state.
- Preserve normal onboarding/member-missing retry behavior outside the hosted-run acquire path.
- Surface a clear data-integrity/stale-runner error that Cloudflare treats as terminal for that user's immediate alarm retry path.

## Success criteria

- Web hosted-run acquire returns a typed non-retryable stale-runner/data-integrity error for missing hosted members on the acquire path.
- Cloudflare classifies that typed acquire failure as terminal, logs/records observable stale-runner details, and clears/does not reschedule the immediate retry alarm.
- Existing retryable acquire failures still schedule retry alarms.
- Focused web and Cloudflare tests cover both terminal stale missing-user acquire and retryable failure behavior.

## Scope

- In scope: `apps/web` hosted-run acquire route/store helpers, `apps/cloudflare` hosted-run acquire client and Durable Object alarm/nudge classification, directly coupled hosted-run tests/contracts if needed.
- Out of scope: normal hosted onboarding/member creation flows, unrelated hosted ingress/Linq/finalize cleanup work, schema changes unless inspection proves they are required.

## Constraints

- Technical constraints: keep web-owned hosted-run protocol authoritative; Cloudflare must not invent durable product truth. Do not silence real member-missing bugs outside stale runner/acquire recovery.
- Product/process constraints: preserve unrelated dirty-tree work and active hosted runner rows. Use a scoped additive change because overlapping hosted Cloudflare lanes are active.

## Risks and mitigations

1. Risk: treating all missing members as terminal could hide real onboarding or activation bugs.
   Mitigation: classify terminal behavior only at the signed internal hosted-run acquire boundary and use a distinct error code/details.
2. Risk: Cloudflare alarms retry automatically if the handler throws.
   Mitigation: catch the classified terminal acquire error, record the condition, delete/avoid rescheduling the alarm, and return successfully from the alarm path.

## Tasks

1. Trace current hosted-run acquire and Durable Object alarm retry handling.
2. Add/extend typed error response from web acquire for stale missing members.
3. Add Cloudflare acquire error classification and terminal alarm handling.
4. Add focused regression tests for terminal stale runner and retryable acquire failures.
5. Run focused verification, required audit passes, and close/commit if safe.

## Decisions

- Use the hosted-run acquire boundary as the terminal stale-runner seam; normal onboarding member lookup paths stay unchanged.

## Verification

- Commands to run: focused Vitest for affected hosted-run/Cloudflare tests, `pnpm typecheck`, `pnpm test:diff` or scoped owner verification as available, `git diff --check`.
- Expected outcomes: stale missing-user acquire returns non-retryable details and Cloudflare clears alarm state; retryable acquire failures continue to reschedule.
Completed: 2026-04-24
