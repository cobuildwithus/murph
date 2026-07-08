# Ops primitive to rehome hosted member Linq home line

Status: completed
Created: 2026-07-06
Updated: 2026-07-06

## Goal

- Ship a founder-gated hosted ops primitive that can move one active hosted member's Linq home-line authority to an explicitly selected assignable home line.
- Preserve the existing bare-authority semantics: clear bound chat and pending route state, reset `linqLastInboundAt`, and require the member to text the new line before Murph-initiated sends resume.

## Success criteria

- `GET /api/ops/linq-rehome?memberId=...` returns only member routing summary, line hints, lookup keys, and capacity counts; it never returns decrypted phone numbers.
- `POST /api/ops/linq-rehome` rejects unauthorized operators, unknown/suspended members, non-assignable targets, already-targeted members, and capacity-exhausted targets with typed hosted onboarding errors.
- Successful rehome is one database transaction guarded by the existing Linq home assignment lock and writes through `upsertHostedMemberHomeLinqRecipientPhoneTx` with `clearPending: true`.
- Tests cover the requested success, pending-clear, none-authority, target rejection, already-target, capacity, member validation, auth/body validation, and raw-number exposure cases.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-ops/linq-line-rehome.ts`
  - `apps/web/app/api/ops/linq-rehome/route.ts`
  - Focused hosted-web tests for the new primitive and route
  - Exporting or sharing `startOfUtcDay` only if that is the simplest way to keep one source of truth
- Out of scope:
  - Automatic health-triggered failover, cron, watchers, or bulk/multi-member moves
  - Ops UI
  - Schema changes
  - Changes to webhook, egress, routing policy, or the existing rehome write primitive
  - Thread-route cleanup for stale old 1:1 chats

## Constraints

- Technical constraints:
  - Raw phone numbers must not be returned by the ops route or committed fixtures/docs.
  - The mutation must fail closed for degraded/unconfigured/disabled target lines by relying on `listHostedLinqAssignableHomeLines`.
  - Already-on-target detection must compare against lookup-key read candidates for the target phone, not only strict lookup-key equality.
  - Capacity checks must reuse `chooseHostedLinqHomeLine` with the target as the only candidate and exclude the member's current binding from active counts.
- Product/process constraints:
  - Keep the primitive explicit and founder-gated; no automatic trigger.
  - Preserve anti-cold-contact behavior by not carrying last-inbound across lines.
  - Leave the working tree uncommitted for supervisor review.

## Risks and mitigations

1. Risk: exposing decrypted phone numbers through the ops overview or mutation result.
   Mitigation: use phone hints and lookup keys only in response types and tests.
2. Risk: rehoming onto an unhealthy or disabled line.
   Mitigation: target must be present in `listHostedLinqAssignableHomeLines`.
3. Risk: bypassing assignment capacity/pacing invariants.
   Mitigation: acquire the assignment lock and reuse the existing chooser/counts with the target as the only candidate.
4. Risk: stale `hosted_thread_route` rows for the old 1:1 chat can allow an in-flight runner session with old route authority to egress on the old thread until sessions roll over.
   Mitigation: document as accepted residual for this manual healthy-line migration; thread-route cleanup is out of scope and belongs to future banned-line failover work.

## Tasks

1. Inspect the existing hosted ops, Linq line-store, routing, and test harness patterns.
2. Implement the read-only overview and transactional rehome service.
3. Add the ops API route with existing ops auth and JSON-body validation helpers.
4. Add focused hosted-web tests for library behavior, route auth/body handling, and no raw-number responses.
5. Run required verification and completion audits (`security-privacy-review`, `coverage-write`, and local final review).

## Decisions

- Use the existing `upsertHostedMemberHomeLinqRecipientPhoneTx` primitive unchanged.
- Keep post-rehome authority bare by design; the member must text the new line to bind the new chat and satisfy the recent-reply egress guard.
- No durable docs update is needed beyond this active plan because this change adds an ops primitive, not a new durable architecture rule or automatic failover behavior.

## Verification

- Setup completed:
  - `pnpm install`
  - `pnpm --dir apps/web prisma:generate`
- Required checks completed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-ops-linq-line-rehome.test.ts` passed.
  - `pnpm typecheck` passed after generating ignored local package build artifacts required by unrelated workspace package entrypoints.
  - `pnpm test:diff apps/web/src/lib/hosted-ops/linq-line-rehome.ts apps/web/app/api/ops/linq-rehome/route.ts apps/web/src/lib/hosted-onboarding/linq-home-routing.ts apps/web/test/hosted-ops-linq-line-rehome.test.ts` passed.
- Audit passes completed:
  - `security-privacy-review`: no medium-or-higher findings. Residual assumptions: ops allowlist is the intended authority, and stale old thread-route cleanup remains out of scope for this primitive.
  - `coverage-write`: added test proof that already-on-target detection works against lookup-key read candidates across contact-privacy key rotation; focused test passed.
  - Parent local final review: no unresolved implementation findings.
- Notes:
  - The owner verifier still emits pre-existing apps/web lint warnings and a Turbopack NFT warning unrelated to this diff; the command exits successfully.
  - The working tree is intentionally uncommitted for supervisor review.
Completed: 2026-07-06
