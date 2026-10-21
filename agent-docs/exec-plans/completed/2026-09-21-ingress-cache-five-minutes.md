# Extend ingress cache retention with member isolation proof

## Outcome and invariant

Reduce repeated KMS calls between conversational turns by extending the existing
process-local ingress cache from 30 seconds to five minutes. Member, root,
domain, signed-envelope and current authority boundaries must remain intact.

## Owner and scope

Change only the existing cache TTL; preserve its fixed deadline, 128-entry FIFO,
independent buffers, fresh metadata/signature checks and transaction revalidation.
Update live architecture/security owners. No new state, dependency or abstraction.
Completed prior plans remain historical and unchanged.

## Product UX

Outcome: more same-process requests reuse validated ingress keys.
Reaches: ordinary follow-ups within five minutes, plus expiry and revoked roots.
Proof: real root preparation and secure-box tests with synthetic KMS/DB boundaries,
two concurrently warm members, wrong-member rejection and exact fixed expiry.
No production latency guarantee or deployed measurement is claimed.

## Security and rollout

The cache already hashes the complete verified envelope, including member identity,
and verifies the requested member/domain before lookup. Longer retention increases
process-memory exposure duration and KMS-only revocation lag to five minutes;
database revocation and locked authority are still live. Capacity stays 4 KiB of
cache-owned root bytes. Web-only change with no schema/protocol or deploy ordering;
old/new processes can coexist and process replacement clears cached material.

## Verification and completion

- [x] Extend TTL and current owner documentation.
- [x] Prove five-minute reuse, fixed expiry, member isolation and revocation.
- [x] Run focused crypto tests, Web typecheck, complexity and diff checks.
- [x] Push the owned PR and run ReviewGPT round 2 concurrently with exact-head CI.
- [x] Validate review and close implementation plan. Final exact-head CI remains
  tracked in the PR body by the same completion owner.

Focused proof: 104 tests in five crypto/composition suites passed; the 29-case
ingress suite passed again after adding four-minute revocation timing. The
complexity guard passed with no new debt. Existing changelog item
`less-repeated-message-preparation` already covers this same performance outcome.
Web typecheck passed after the final TypeScript edit. Parent candidate review
confirmed only the TTL changes production behavior; key identity, authority,
capacity, cancellation and erasure owners are unchanged. Product UX: Ready.

## Review and handoff

ReviewGPT round 2 passed on `844d67a557dfcb38a34f56ac4ba37c944e1701a8`,
with zero findings and no unresolved accepted findings. Full sensitive snapshot,
verified GPT-6 Pro response, exact capture/hash/marker, and over eight minutes of
response time were validated. The reviewer traced member/domain/root identity,
signed envelope and KMS context validation, request/transaction authority, real
secure-box crypto and buffer ownership; 20 isolated actual-owner checks passed.
Five-minute retention explicitly extends resident-key exposure and KMS-only
revocation lag, while fresh database authority remains mandatory.

After review, only the documentation index placement changed to avoid a current
base append conflict. Merge-tree succeeds against fetched base
`94698dcbfb8b9fdaa04b22539cf32f4cf6add769`. This closeout also changes only docs;
production, tests, configuration and implemented contract equal the reviewed head.
Final required CI is pending for the closeout head and must finish before PR
completion. No merge, deployment or production performance claim.
Status: completed
Updated: 2026-09-21
Completed: 2026-09-21
