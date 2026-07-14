# Linq mailbox-backed reply authority

## Goal

Stop current Linq replies from failing with route-authority 403s when the
member's home chat binding changes after the inbound was durably accepted.

## Evidence

- Production accepted the inbound webhook and two outbound provider requests.
- The same hosted container later failed on
  `HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH`.
- The live-route hotfix deliberately ignores runner-carried proof, but its
  fallback checks only the member's current home/pending chat. A persisted
  reply to an exact mailbox inbound therefore fails after a chat-binding
  transition even though the server still owns the authoritative inbound.

## Success criteria

- An exact direct Linq inbound is accepted when its member, mailbox row,
  dedupe/event identity, timestamp, chat, and provider message id all match the
  encrypted persisted wake.
- Fabricated, cross-member, mismatched, and non-direct proofs remain denied.
- Live explicit thread routes remain authoritative and cannot be overridden by
  mailbox proof.
- Focused tests, typecheck, required audits, main push, immediate Cloudflare
  deploy, and production log verification complete.

## Approach

1. Rehydrate the exact mailbox wake only when live thread-route lookup misses.
2. Accept that proof only for a provider inbound in a direct Linq thread.
3. Keep current home/pending and participant checks unchanged.
4. Add focused allow/deny regression coverage and deploy the scoped fix.

## State

Implementation and local verification complete. The required independent
security/privacy and coverage passes returned zero findings. The required deep
review was started but its workers exhausted their service usage allowance
before returning findings; parent final review found no remaining actionable
gap. Main push, deployment, and production readback follow this scoped commit.

## Verification

- Regression proof before the fix: 23 passed, 1 failed with
  `HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH` for the exact persisted direct
  inbound case.
- Focused post-fix proof: 66 tests passed across Linq egress authority and
  hosted mailbox storage.
- Web TypeScript compilation, focused ESLint, and `git diff --check` passed.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
