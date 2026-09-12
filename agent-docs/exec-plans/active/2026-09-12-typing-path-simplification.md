# Simplify message ingress and activation work

Status: active
Created: 2026-09-12
Updated: 2026-09-12

## Goal

- Reduce unnecessary work and duplicated ownership in Linq ingress, member activation, and runtime wake handoff while preserving private/group audience boundaries and durable delivery.

## Success criteria

- Obtain the requested ReviewGPT deletion review and implement evidence-supported recommendations.
- Prefer net removal of responsibilities, branches, and awaited work without replacement caches, schedulers, or parallel planners.
- Focused regression tests and affected typechecks pass; candidate review, applicable final ReviewGPT, and exact-head CI close the evidence.

## Scope

- In scope: direct/group classification, ingress preparation, duplicate onboarding-follow-up seeding, and wake handoff simplification supported by review.
- Out of scope: removal of current product features, production mutations, deployment, unrelated refactoring.

## Constraints

- Technical constraints: keep cryptographic preparation outside short transactions, exact authority validation, canonical mailbox durability, and one recovery owner.
- Product/process constraints: retain timely onboarding follow-ups, activation anchoring, late route availability, completed/archived suppression, and correct private/group routing. Treat existing implementation assertions as reviewable, not intrinsic requirements.

## Risks and mitigations

1. Removing classification could disclose private context to groups. Prove the surviving authority with direct/group and conflicting-route tests.
2. Removing activation seeding could strand follow-up enrollment. Prove maintenance liveness without another inbound message, including restart and delayed route availability.
3. Removing apparent duplicate reads could weaken current authority or move external work into transactions. Trace exact data dependencies and preserve transaction boundaries.

## Tasks

1. Done: requested source-attached ReviewGPT recommendations and applied the bounded patch after local inspection.
2. Done: validated audience precedence, transaction authority, wake admission, and activation liveness counterexamples.
3. Done: removed ordinary direct classification HTTP and unused identity reads; consolidated wake handoff; corrected hosted route-validation forwarding.
4. Done: focused tests/typechecks, product journey proof, lint, complexity review, and changelog proof.
5. In progress: candidate committed and draft PR opened; complete required review/CI and close this plan.

## Decisions

- The original session owns review capture and completion. Production diagnostic details and personal identifiers stay out of artifacts.
- Product UX: Patch. Outcome: earlier typing and reply admission through less work. Reaches: existing private conversations, new-member activation, group messages, and delayed/replayed wakes. Proof: composed admission, audience, scheduling, and recovery tests selected after review.
- Accepted review recommendations: authenticated explicit-direct payloads need no HTTP classification when no canonical group route contradicts them; Family alone consumes full private identity snapshots; the existing mailbox handoff owns direct-hint overlap and post-response lifetime.
- Retained activation seeding: pristine silent activation can lack reconciler-readable delivery defaults, and foreground reconciliation can precede queued activation. Removing the seed alone can strand follow-ups. A later deletion must establish route availability and a post-activation continuation using existing owners, with no infinite polling or replacement scheduler.
- Retained bounded direct retry and legacy accepted-response handling: neither alert measured retry value or established that old deployed consumers are absent.
- Corrected the review patch's complexity regression by always constructing the resolved event. Replaced its mocked route-profile assertion with an actual vault/automation integration test; without the fix, hosted email creation fails under local delivery rules.
- No assistant instructions, tool contracts, model input builders, or reply policy changed. Deterministic route/admission/scheduling proof covers this change; no new stochastic journey is needed.

## Verification

- Commands to run: affected Web/runtime/engine tests, affected typechecks, `pnpm complexity:diff`, applicable assistant journey proof, and final review/CI.
- Expected outcomes: preserved product and security invariants with fewer hot-path calls and no new state or recovery owner.
- Web baseline after patch: 408 tests passed across dispatch, group routing, wake handoff, and direct ensure; final classification rerun: 376 passed. Group-tool route adaptation: 23 passed.
- Engine mocked managed suite: 60 passed before replacing the new wiring-only test with core integration proof. Hosted email integration passes with the fix and fails without it with the expected local-email rejection.
- Web typecheck: initial result found a void-return caller after handoff consolidation; corrected at the caller, then prepared typecheck passed. Engine typecheck passed before final integration-test edit; final check pending.
- Complexity guard passed: classification complexity decreased from 27 to 26; existing planner hotspots remain and do not justify a broad second planner or speculative abstraction.
- Final managed-automation core integration: 44 passed; engine typecheck passed. Web prepared typecheck passed after final source cleanup. Web lint passed with pre-existing warnings; the only unused import in changed source was removed and focused lint passed.
- PostgreSQL ownership proof: the shared test database had stale schema and permissions, so its setup failures were not behavioral evidence. Created an isolated local test database with repository migrations; seven selected signup/instant-start/cross-channel ownership races passed.
- Product UX verdict: Ready for the bounded patch. Explicit direct ingress omits provider classification and unused identity loads; group precedence and ownership conflicts stay fenced; wake handoff overlaps only after admission and retains durable failure semantics; real hosted-email automation creation succeeds.
- Changelog: two content-only entries; production archive rendering passed all ten focused tests, and Web prepared typecheck passed after generation. The documented app-directory test command found no files; existing Frog entry `20260911184822-documented-changelog-test` already owns that issue. Used repository-root Vitest invocation and created no duplicate entry.
