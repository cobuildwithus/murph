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
- [ ] Push the owned PR and run ReviewGPT round 2 concurrently with exact-head CI.
- [ ] Validate review, close this plan, verify CI and current-base mergeability.

Focused proof: 104 tests in five crypto/composition suites passed; the 29-case
ingress suite passed again after adding four-minute revocation timing. The
complexity guard passed with no new debt. Existing changelog item
`less-repeated-message-preparation` already covers this same performance outcome.
Web typecheck passed after the final TypeScript edit. Parent candidate review
confirmed only the TTL changes production behavior; key identity, authority,
capacity, cancellation and erasure owners are unchanged. Product UX: Ready.
