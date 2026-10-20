# Fixed-canary turn timing diagnostics

## Intent

Distinguish ingress, runtime/provider work, and delivery delay when the existing
protected iMessage canary receives a slow reply or cannot observe one. Its client
already separates sender acknowledgment from total reply time, but locally
available production evidence cannot independently bind that run to the
server-configured canary identity.

## Scope and invariants

Reuse the fixed-identity canary outcome owner and existing typed ingress trace.
Keep the bearer authentication, access checks, input-free request contract,
canonical goal-readiness proof, and original canary failure intact. Return only
bounded counts, finite stage facts, and safe durations; never identifiers,
timestamps, message content, health data, secrets, or provider payloads.
No new state, dependencies, service, endpoint, retry policy, reset, or message.
Missing or ambiguous diagnostics remain explicit rather than proving recovery.

## Work

- [x] Inspect the existing timing, identity, authority, and outcome paths.
- [x] Reproduce sender delay, slow received reply, and unavailable reply with
  three existing synthetic tests; all pass. The complete current runner,
  outcome, and route baseline also passes (164 tests) after canonical local
  Prisma client generation.
- [x] Check relevant open PR behavior; no conflicting canary changes found.
- [x] Have ReviewGPT author the smallest bounded observation and regression proof.
- [x] Critically review, demonstrate missing evidence before and after, and run
  focused tests, typecheck, complexity, documentation, and privacy checks.
- [x] Prepare the scoped candidate and release handoff; final review, exact-head
  CI, merge, serving-revision proof, and production observation remain release
  gates tracked by the owning sweep and PR, not claims of this implementation plan.

## Verification

ReviewGPT authored the patch; parent review checked the complete source, authority
revalidation, indexed query bound, safe projection, and original failure behavior.
Tests-only against the original implementation produced 89 failures and 173 passes.
After applying the implementation, all 262 focused runner/outcome/route/trace tests
pass. Four workflow guards and the canonical Web typecheck pass. Complexity adds
no debt; the outcome function maximum decreases from 19 to 15. The existing
latency dashboard hotspot is unchanged. Documentation and privacy checks are part
of the scoped commit proof.

The query uses the existing member/accepted-time index, reads at most four rows,
and returns at most three observations. It adds one serial query to the protected
canary outcome read, outside member foreground reply processing; no transaction
spans external work. A single three-second best-effort diagnostic request follows
a slow/unavailable canary reply without changing the primary failure or budget.
Older servers remain supported. Missing timing is unknown, not zero or recovery.

## Delivery

This is internal diagnostic coverage, so no public changelog entry is needed.
The production latency symptom remains unresolved. Record release and observation
evidence separately from successful local tests. Native heartbeat controls are
currently unavailable; no custom scheduler is authorized.
Status: completed
Updated: 2026-10-20
Completed: 2026-10-20
