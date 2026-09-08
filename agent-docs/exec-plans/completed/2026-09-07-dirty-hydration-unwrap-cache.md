# Bound repeated key unwraps during dirty payload hydration

Status: completed
Created: 2026-09-07

## Cause and scope

The pending dirty route decrypts up to 500 payloads sequentially without opening
the existing domain-root unwrap cache scope. Payloads sharing one root therefore
repeat the same envelope query and KMS call, amplifying callback latency before
any work is admitted. This Web hydration issue is independent of the runtime
checkpoint repair owned by PR #3025.

## Correction and proof

Scope the shared hydrator with the existing operation-lifetime unwrap cache.
Preserve exact user/domain/root identity, per-payload AAD, existing row/byte bounds
and zeroization. Add no persistent cache, parallel KMS calls or larger timeout.
A composed 500-payload regression uses actual signed root envelopes, secure-box
and compressed dirty payloads with local KMS stubs. Prove one envelope read and
unwrap per shared root per operation, complete payloads, fresh subsequent scopes,
and rejection/cleanup for mismatched ciphertext.

## Completion

Run crypto, dirty-store and wake tests, Web typecheck, complexity and docs checks.
Commit the fix and finish parent review. Final ReviewGPT reached its three-round
cap; record a retrospective and obtain the required continuation decision before
a fourth round. Do not claim merge readiness without a later resolved review.

## Results and cap retrospective

The production-code regression failed with 500 envelope reads instead of one.
After the nine-line cache-boundary correction, it passes complete 500-payload
readback, fresh independent operations, per-row AAD rejection, and key wiping
on success/failure. All 288 crypto, dirty-store and wake tests pass; nine unchanged
changelog tests also pass. Web typecheck, focused lint, complexity and docs drift
pass. Parent review confirms the existing identity-keyed cache owns cleanup,
with no persistent cache or parallel remote calls. Complexity debt is unchanged.

Round 1 identified retry-state loss in the initial runtime deferral approach;
that finding was fixed and round 2 passed. A concurrent runtime recovery PR then
made that implementation redundant, so it was removed. Round 3 on the narrowed
capacity change identified this separate pre-admission hydration amplification.
The correction reuses the existing cache rather than adding another state owner.
The final scope is Web capacity plus efficient hydration; #3025 owns runtime
recovery. No fourth review is launched without the required explicit continuation
decision. Exact-head CI and the later resolved review remain release gates.
Updated: 2026-09-07
Completed: 2026-09-07
