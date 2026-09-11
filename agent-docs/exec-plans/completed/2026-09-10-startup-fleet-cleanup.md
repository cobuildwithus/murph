# Delete obsolete member prewarm work

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Remove obsolete member-specific hint processing while preserving memberless standby preparation, normal execution admission, and legacy target cleanup. Current Web has no production hint callers; the remaining authenticated receiver delegates only to a no-op logger.

## Success criteria

- Authenticated legacy hints receive success without resolving a runtime owner.
- Standby preparation, message allocation, withdrawal, and old-target cleanup retain their existing behavior.
- Focused tests, typecheck, parent review, required ReviewGPT, and exact-head CI pass.

## Scope

- In scope: Worker no-op response, downstream UserRunner and container hint RPC deletion, obsolete client and timing plumbing, and reader-only runner-secret capability if deployed metadata proves no current consumer.
- Out of scope: allocation simplifications already landed on main; standby pool redesign; merge or production deployment.

## Constraints

- Keep existing OIDC, exact target binding, method enforcement, and request resource bounds. Add no state, configuration, dependency, or protocol negotiation.
- Production evidence stays outside artifacts. Verify metadata only; never retrieve secret values.
- Product UX outcome: preserve standby-backed message startup with less obsolete work. Reaches: old hints, fresh messages, retained runners, and delayed hints after deletion or withdrawal. Proof: successful no-op response without owner lookup, plus existing standby and cleanup coverage.

## Risks and mitigations

1. Removing a method still used by deployed callers could break rollout.
   Mitigation: preserve authenticated HTTP compatibility and prove each internal removed method has no current producer; describe Worker/Durable Object and old-container skew.

## Tasks

1. Delete remaining no-op hint paths and verify each obsolete consumer.
2. Establish runner-secret usage metadata before deciding its deletion.
3. Run focused checks, review privacy and complexity, and update owner docs.
4. Commit and open draft PR; admit stable candidate to review and CI.
5. Record results and close the plan before final handoff.

## Decisions

- Standby coordinator remains the speculative container-preparation owner. The Worker bounds and ignores old hint bodies; an inert UserRunner method temporarily accepts old Worker RPC calls until those producers drain. Two constant-response container methods likewise preserve calls from pre-unified-fleet UserRunner producers; their parsing, telemetry, and state machinery are deleted.
- Retained-slot receipt reuse and stopped-container retirement cleanup already landed on main and require no duplicate implementation.

## Verification

- Passed: Cloudflare tests (623 plus 2 final compatibility cases), Web handoff/changelog tests (250), control-client tests (88), runtime-control tests (45), and runner secret/environment/storage tests (96). Cloudflare, Web, control-client, and hosted-execution typechecks pass; both edited public package builds pass. Parent candidate review, whitespace and complexity checks pass. PR review and exact-head CI remain external completion gates.
- New Worker compatibility hints make no downstream calls. Empty effective secret allowlists skip the object read; configured keys still read and validate. Three existing deadline-test fixtures explicitly enable a synthetic key so their storage barriers retain their intended purpose.
- Deployed allowlist details could not be established through bounded metadata reads, so the configured capability is retained; no secret values were inspected.
- Complexity: route maximum falls from 18 to 10; no debt regression. Existing hotspots in unchanged lifecycle/provider/diagnostic branches do not justify additional refactors.
Completed: 2026-09-10
