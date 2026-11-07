# Preserve durable Ask handoff during warm continuation

Status: completed
Created: 2026-09-30
Updated: 2026-09-30

## Goal

Resume detached Ask work when a warm invocation genuinely continues foreground work, while preserving prompt durable successor handoff at idle checkpoint boundaries.

## Scope and constraints

Repair the overly broad resume introduced in PR #3928. Reuse existing lifecycle decisions; preserve controller serialization, checkpoint quiescence, expiry, cancellation, handoff and exact-request authority. No new persisted state, retry policy, provider contract or production mutation. Completed predecessor plans remain historical. Functional PR stays for human merge.

## Evidence and decisions

The new composed retained-Ask regression passes, but CI at the first reviewed head fails both existing startup cases for Ask arriving before/after checkpoint. Their bounded checkpoint assertion exposes repeated restart/abort instead of durable successor return. Accept these as a real regression, not flakes or obsolete tests. Final ReviewGPT round 1 returned PASS; CI remains authoritative and requires a corrected candidate and round 2.

## Tasks

1. Ask ReviewGPT to implement the narrow lifecycle correction without weakening either old successor case or the new continuation case.
2. Reproduce CI failures locally; prove all three scenarios pass with the correction, plus adjacent shutdown, current-sender, clinical and detached-controller suites.
3. Parent inspect the patch, typecheck, complexity and owner docs; close this remediation plan, commit, push from Draft, and start final round 2 concurrently with CI.

## Product UX

Effort: Patch. Ready only when continued work prepares its retained Ask before expiry and idle checkpoint returns the request durably to its successor without spinning. Original permissions, destination and expiry are unchanged.

## Verification

The first ReviewGPT remediation moved resume to full mailbox admission and the existing observed-conversation barrier. Parent ran all six real lifecycle suites: 142/143 passed. Both restart loops are gone; the remaining after-checkpoint successor test still sees one premature read before a ready durable effect. Runtime typecheck, docs gardening and complexity pass.

A temporary diagnostic experiment gating full-admission resume on no pending/ready durable effects and no durable follow-up makes all three focused composed cases pass. The experiment was reverted; ReviewGPT is authoring the final amendment. Preserve the original tests and their call-count/checkpoint limits.

Required exact-head CI and final ReviewGPT round 2 remain completion gates. The immutable first-reviewed baseline is the original candidate, not a reset review history. Production outcome remains unverified until an authorized release owner deploys and observes the exact accepted Ask outcome. Historical logs lack the admission/effect eligibility fields needed to prove which corrected branch a past request traversed; the composed tests establish the current-code defect and boundaries, not historical recovery.


## Final correction and local completion evidence

ReviewGPT authored the final amendment using only the ready-effect queue guard: pending effects are moved there before post-checkpoint mailbox admission. The pending-effect and follow-up predicates from the diagnostic experiment are unnecessary. Parent inspected the complete source and live protocol diff, and restored the unrelated original clinical-resume comment. All original tests remain byte-identical.

Final `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --no-coverage` across startup, causal-input, detached-Ask, current-sender-Ask, shutdown and clinical-checkpoint suites: 143/143 passed. The original source fails the added continuation test; the first candidate fails both successor cases; final candidate passes all three and their surrounding suites. Runtime typecheck passed. Complexity passed with maximum 223 and debt 468 unchanged across 19 existing hotspots; the new small guards add no above-threshold function. Documentation gardening is required before the scoped commit.

Product UX: Ready for candidate review. Continued admitted work prepares its retained request, while checkpoint-safe imports and pending ready effects preserve durable successor handoff. No new awaited operation, state, timer, retry, dependency, permission, provider input or protocol shape. Previous Web typecheck and ten changelog archive checks remain applicable because their inputs did not change during remediation.

This plan records completed implementation and focused proof. Final ReviewGPT round 2 and exact-head CI remain the PR completion gates; the PR body owns their live status. Functional merge and deployment remain with the human release owner.
Completed: 2026-09-30
