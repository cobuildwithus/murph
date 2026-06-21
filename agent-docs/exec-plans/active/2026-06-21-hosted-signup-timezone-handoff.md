Goal (incl. success criteria):
- Reproduce why a valid signup timezone can be absent when the hosted vault is first initialized, causing the New York fallback to become canonical.
- Fix the loss at the owning web activation boundary without adding a second timezone source of truth or a new background repair system.
- Success means a focused regression test fails on the current implementation, the validated signup timezone survives activation ordering, and existing explicit/missing-timezone behavior stays covered.

Constraints/Assumptions:
- `apps/web` owns signup and activation facts; `packages/assistant-runtime` consumes the signed activation wake.
- Keep `pendingActivationTimeZone` transient and activation-scoped unless the reproduction proves that model cannot be made correct.
- Prefer one explicit transaction/state transition over retries, queues, new persisted markers, or runtime-side reconciliation.
- Preserve unrelated active ledger rows and avoid the hosted webhook files owned by the ingress-wake-repair lane.

Key decisions:
- Prove the failing ordering with a focused service or activation test before changing production code.
- Keep the correction inside the existing member-row/activation transaction boundary if that can make the handoff deterministic.

State:
- In progress.

Done:
- Traced browser capture, validated header fallback, transient member storage, activation wake construction, and vault bootstrap fallback.
- Confirmed the current timezone write can report no update without surfacing or repairing the lost handoff.

Now:
- Add the smallest production-faithful reproduction for the ordering that drops the timezone.

Next:
- Implement the narrow owner-boundary fix, run scoped verification, and complete required security, coverage, and deep-review passes.

Open questions (UNCONFIRMED if needed):
- Whether the deterministic fix belongs in Privy completion's member transaction or activation's locked transition will be decided by the failing test and current checkout flow.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/authentication-service.ts
- apps/web/src/lib/hosted-onboarding/hosted-member-store.ts
- apps/web/src/lib/hosted-onboarding/member-activation.ts
- apps/web/test/hosted-onboarding-privy-service.test.ts
- apps/web/test/hosted-onboarding-member-activation.test.ts
- pnpm test:diff <touched paths>
