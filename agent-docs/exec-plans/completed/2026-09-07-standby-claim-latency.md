# Implement foreground runner handoff timing and diagnostics

Status: completed
Created: 2026-09-07
Updated: 2026-09-07

## Goal

- Remove reproduced avoidable delays before a foreground message acquires its runner, then deploy and verify the corrected production release.

## Success criteria

- A deterministic production-owner regression fails before the fix and passes afterward.
- Focused allocation/lifecycle tests and Cloudflare typecheck pass; required candidate CI and review pass.
- The protected deployment completes and proves the intended Worker/container release; bounded metadata confirms the affected path.

## Scope

- In scope: standby claim, cold fallback, existing allocation diagnostics, deployment readiness.
- Out of scope: assistant prompts, model selection, message contents, unrelated runtime work.

## Constraints

- Technical constraints: preserve exact member binding, durable stop targets, write fences, bounded claim attempts, and orphan cleanup. Keep the coordinator as inventory owner and UserRunner as execution owner.
- Product/process constraints: preserve foreground priority, existing replies and failure recovery; use synthetic fixtures and content-free diagnostics. Deploy through the protected private workflow.

## Risks and mitigations

1. Misattributing the allocation total to the claim timer.
   Mitigation: inspect the deployed implementation and distinguish claim, cold binding, and container readiness.
2. A late bind could create a second member target.
   Mitigation: retain the existing pinned-target retry contract and prove ambiguous completion.
3. An existing failed staged deployment can block delivery.
   Mitigation: inspect live release metadata and quota failure before dispatch; preserve the serving release and fix forward through the deployment owner.

## Tasks

1. Trace production timing and exact release; reproduce the causal allocation defect.
2. Make the smallest owner-level correction and add deterministic success/failure proof.
3. Replay warm-available, warm-unavailable, late-bind, and background-exclusion journeys; run focused checks and review.
4. Commit, push, complete required CI and ReviewGPT, merge, and deploy through the protected workflow.
5. Verify release convergence and bounded production timing, then close the task.

## Decisions

- The existing allocation duration includes cold fallback binding; a timeout reason alone does not prove timer overrun.
- No new allocation owner, queue, member state, or credentials are required.

## Verification

- Focused Cloudflare standby and runner identity tests; Cloudflare typecheck; authored complexity check; exact-head required CI.
- Expected outcomes: ready inventory remains usable, fallback is bounded, late binding stays pinned, and no unauthorized container receives member work.

## Investigation checkpoint

- Existing owner suites pass: 104 standby and container-identity tests.
- A temporary synthetic controller experiment supplied a claim after 350 ms, a bind after 100 ms, and cold readiness after 2,500 ms. The current 250 ms deadline selected the cold path (about 2.77 s); a temporary 1,000 ms deadline selected warm inventory (about 0.47 s). Both the experimental source change and test were removed afterward. This proves the conditional mechanism, not the production RPC duration or inventory availability.
- Separate local workerd probes returned coordinator results immediately while background timer, SQLite/alarm, and nested Durable Object RPC work remained pending. Background waitUntil by itself is not a reproduced response blocker.
- No production behavior change, commit, PR, or deployment has been made. Definitive live claim timing remains required before selecting a correction.
- The protected deployment path also has an account-capacity blocker. Preserve the documented serving capacity; do not silently reduce it to bypass a failed candidate deployment.

## Candidate implementation and product proof

- Expand the existing optional distributed claim/bind deadline from 250 ms to 1,000 ms, still capped by the current request budget. No retries or network calls are added. A stalled coordinator can add at most 750 ms compared with the prior policy; a 350 ms claim plus a 100 ms bind now uses warm inventory.
- Record reconciliation, claim wait and binding durations in the existing orchestration diagnostics. Log both coordinator handling and caller RPC settlement with an opaque claim event identifier, including late replies.
- Proved the ready-runner regression fails with the former constant and passes with the candidate. Existing command-budget, no-ready, background exclusion, late-bind, retirement, and exact-member fence proofs pass.
- Focused allocation/lifecycle suite: 171 tests passed. Hosted execution suite: 633 tests passed. Cloudflare typecheck and complexity diff passed. Existing unrelated complexity hotspots remain unchanged.
- Product UX: patch; warm foreground allocation, unavailable pool fallback, background exclusion, and uncertain bind recovery are the material journeys. Local proof is ready; deployment and live timing remain pending.
- Provider input is unchanged for individual and group turns; no prompt, tool schema, or provider configuration is edited.

## Verified implementation and release handoff

- PR #3036 implementation at `541d33eec63650113117b2407647d19966fe5a26` passed all 32 reported CI checks and the final parent review.
- Final ReviewGPT round 1: full snapshot, exact first-reviewed head above, verified `gpt-6-pro` response model, matching response digest and exact conversation turn, completion marker present, and the wrapper-enforced minimum marked-response interval of 270 seconds. The review covered deadline sharing, fallback, late settlement, exact-target reservation/fencing, background exclusion, coordinator recovery and optional diagnostic propagation. Outcome: PASS, zero findings.
- This archives the implementation phase only. The user-requested production rollout remains unfinished: the two release banks must fit account capacity, followed by the protected deployment and a live allocation/typing trace. Do not infer deployment or production latency improvement from this record.
- Release handoff: preserve serving release identity and running invocations; settle the explicit capacity choice, deploy Web and Worker/runner through their existing owners, verify active release convergence, and measure an authorized message using the new diagnostic leaves.
Completed: 2026-09-07
